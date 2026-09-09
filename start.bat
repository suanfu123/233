@echo off
chcp 65001 >nul
title Minecraft 1.16.5 网页版 - 本地服务器
cd /d "%~dp0"

echo ==============================================
echo   Minecraft 1.16.5 网页版
echo ==============================================
echo.

where node >nul 2>nul
if %errorlevel%==0 (
    echo [1/2] 正在启动 Node 静态服务器...
    start "" http://localhost:8080/
    node server.js 8080
    goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
    echo [1/2] 未找到 Node, 使用 Python 启动...
    start "" http://localhost:8080/
    python -m http.server 8080
    goto :eof
)

echo 未找到 node 或 python, 请安装其中之一后重试。
pause
