// Quant for Windows: a full node (wallet, miner, tokens) with a WebView2 window on top.
// The UI is one bundled HTML page; it talks to the node through two bound functions:
//   rpc(method, params)  -> any node RPC (runs on a worker thread, resolves a Promise)
//   app(command, args)   -> things that aren't RPCs: opening the wallet file, links, version
// Options: --regtest | --testnet | --mainnet, --datadir=DIR, --debug (devtools)
#include <atomic>
#include <fstream>
#include <string>
#include <thread>

#include <windows.h>
#include <shellapi.h>

#include "webview.h"
#include "node/node.h"
#include "util/log.h"
#include "wallet/mnemonic.h"
#include "ui_bundle.h" // generated: const char* QUANT_UI_HTML

using quant::json;

static std::string arg_value(const std::string& a, const char* key) {
    std::string p = std::string(key) + "=";
    return a.rfind(p, 0) == 0 ? a.substr(p.size()) : "";
}

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    quant::NodeConfig cfg;
    cfg.log_stdout = false;
    bool debug = false;
    int argc = 0;
    LPWSTR* wargv = CommandLineToArgvW(GetCommandLineW(), &argc);
    for (int i = 1; i < argc; i++) {
        char buf[1024];
        WideCharToMultiByte(CP_UTF8, 0, wargv[i], -1, buf, sizeof buf, nullptr, nullptr);
        std::string a = buf;
        if (a == "--regtest") cfg.net = quant::Network::Regtest;
        else if (a == "--testnet") cfg.net = quant::Network::Test;
        else if (a == "--mainnet") cfg.net = quant::Network::Main;
        else if (a == "--debug") debug = true;
        else if (!arg_value(a, "--datadir").empty()) cfg.datadir = arg_value(a, "--datadir");
    }
    LocalFree(wargv);

    quant::Node node(cfg);
    std::string err;
    bool started = node.start(&err);

    webview::webview w(debug, nullptr);
    w.set_title("Quant");
    w.set_size(1240, 820, WEBVIEW_HINT_NONE);
    w.set_size(900, 600, WEBVIEW_HINT_MIN);

    std::atomic<int> busy{0};
    // rpc(method, params): run on a worker so mining/sending never freezes the window.
    w.bind("rpc", [&](const std::string& id, const std::string& req, void*) {
        busy++;
        std::thread([&, id, req] {
            int status = 0;
            std::string out;
            try {
                json a = json::parse(req);
                std::string method = a.at(0).get<std::string>();
                json params = a.size() > 1 ? a[1] : json::array();
                if (!started) throw std::runtime_error("node not running: " + err);
                out = node.rpc(method, params).dump();
            } catch (const std::exception& e) {
                status = 1;
                out = json(std::string(e.what())).dump();
            }
            w.resolve(id, status, out);
            busy--;
        }).detach();
    }, nullptr);

    w.bind("app", [&](const std::string& id, const std::string& req, void*) {
        busy++;
        std::thread([&, id, req] {
            int status = 0;
            json out;
            try {
                json a = json::parse(req);
                std::string cmd = a.at(0).get<std::string>();
                json p = a.size() > 1 ? a[1] : json::object();
                if (cmd == "status") {
                    out = {{"started", started}, {"error", err}, {"network", node.params().name},
                           {"wallet_file", started && node.has_wallet_file()}, {"wallet_loaded", started && node.wallet_loaded()},
                           {"datadir", node.dir()}, {"version", "0.2.2"}};
                } else if (cmd == "openWallet") {
                    std::string e;
                    if (!node.open_wallet(p.value("password", ""), &e)) throw std::runtime_error(e);
                    out = true;
                } else if (cmd == "newWords") {
                    out = quant::mnemonic_generate();
                } else if (cmd == "createWallet") {
                    std::string words = p.value("words", ""), e;
                    bool restored = p.value("restored", false);
                    if (!quant::mnemonic_valid(words)) throw std::runtime_error("Those seed words aren't valid (24 words, check spelling and order)");
                    if (!node.create_wallet(words, "", p.value("password", ""), restored, &e)) throw std::runtime_error(e);
                    out = true;
                } else if (cmd == "openUrl") {
                    std::string url = p.value("url", "");
                    if (url.rfind("https://", 0) != 0) throw std::runtime_error("only https links");
                    ShellExecuteA(nullptr, "open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                    out = true;
                } else if (cmd == "prefs") {
                    std::ifstream f(node.dir() + "/../app-prefs.json");
                    out = json::object();
                    if (f) try { f >> out; } catch (...) { out = json::object(); }
                } else if (cmd == "savePrefs") {
                    std::ofstream(node.dir() + "/../app-prefs.json") << p.dump();
                    out = true;
                } else if (cmd == "openDataDir") {
                    ShellExecuteA(nullptr, "open", node.dir().c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                    out = true;
                } else {
                    throw std::runtime_error("unknown command " + cmd);
                }
            } catch (const std::exception& e) {
                status = 1;
                out = std::string(e.what());
            }
            w.resolve(id, status, out.dump());
            busy--;
        }).detach();
    }, nullptr);

    w.set_html(QUANT_UI_HTML);
    w.run();

    // Window closed: let in-flight calls finish, then shut the node down cleanly.
    for (int i = 0; i < 100 && busy > 0; i++) Sleep(50);
    node.stop();
    return 0;
}
