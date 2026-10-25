cmake_minimum_required(VERSION 3.16)
project(quant_app VERSION 0.2.3 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# quant-core (git submodule at external/quant-core, or point QUANT_CORE_DIR at a checkout)
set(QUANT_CORE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/external/quant-core CACHE PATH "quant-core source")
set(QUANT_BUILD_DAEMON OFF CACHE BOOL "" FORCE)
set(QUANT_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(${QUANT_CORE_DIR} quant-core EXCLUDE_FROM_ALL)

# UI: ui/ is bundled into one HTML page (tools/bundle.mjs) and compiled into the exe.
set(UI_BUNDLE ${CMAKE_CURRENT_BINARY_DIR}/ui_bundle.html)
file(GLOB UI_FILES ${CMAKE_CURRENT_SOURCE_DIR}/ui/*)
add_custom_command(
  OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/ui_bundle.h
  COMMAND node ${CMAKE_CURRENT_SOURCE_DIR}/tools/bundle.mjs ${CMAKE_CURRENT_SOURCE_DIR}/ui ${CMAKE_CURRENT_BINARY_DIR}/ui_bundle.h
  DEPENDS ${UI_FILES} ${CMAKE_CURRENT_SOURCE_DIR}/tools/bundle.mjs
  COMMENT "Bundling UI")

add_executable(quant-app WIN32 src/main.cpp src/app.rc ${CMAKE_CURRENT_BINARY_DIR}/ui_bundle.h)
set_target_properties(quant-app PROPERTIES OUTPUT_NAME "Quant")
target_include_directories(quant-app PRIVATE ${CMAKE_CURRENT_BINARY_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview)
target_link_libraries(quant-app PRIVATE quant advapi32 ole32 shell32 shlwapi user32 version)
target_compile_definitions(quant-app PRIVATE WEBVIEW_STATIC)
target_link_options(quant-app PRIVATE -static -mwindows)
