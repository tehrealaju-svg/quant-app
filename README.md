# Quant for Windows

Wallet, one-click miner, meme coins (create + trade) and a full Quant node in one window.
Native C++ (quant-core built in) with a WebView2 UI — no Electron, ~5 MB.

## Use
Download `Quant.exe` from Releases and run it. Windows 10/11 already include WebView2.
Options: `--testnet` (default) `--regtest` `--datadir=DIR` `--debug`.

## Build (MinGW-w64, CMake, Ninja, Node.js)
```
git clone --recursive https://github.com/tehrealaju-svg/quant-app
cmake -S . -B build -G Ninja && ninja -C build      # -> build/Quant.exe
```
`ui/` is bundled into the exe at build time (`tools/bundle.mjs`). To work on the UI in a browser
against a running quantd: `node tools/devbridge.mjs %APPDATA%/Quant/regtest`.
Vendored: webview/webview (MIT), Microsoft WebView2 SDK headers.
