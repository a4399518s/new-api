@echo off
chcp 65001 >nul
echo ==========================================
echo   Build and Deploy sync_hxb_node_web
echo ==========================================

REM Generate timestamp tag
set YYYY=%date:~0,4%
set MM=%date:~5,2%
set DD=%date:~8,2%
set HH=%time:~0,2%
set MN=%time:~3,2%
set SS=%time:~6,2%
set TAG=%YYYY%_%MM%_%DD%_%HH%%MN%%SS%
set TAG=%TAG: =0%


echo.
echo [1/3] Building Docker image...
docker build --progress=plain -t registry.cn-zhangjiakou.aliyuncs.com/fengzhihao/tool:calciumion-new-api-0.12.6-%TAG% .
if errorlevel 1 (
    echo Docker build failed!
    pause
    exit /b 1
)

echo.
echo [2/3] docker compose up -d
echo.
docker compose up -d
if errorlevel 1 (
    echo docker compose up -d failed!
    pause
    exit /b 1
)

echo.
echo [3/3] Deploy completed!
echo.
echo ==========================================
echo   Deploy SUCCESS!
echo   Tag: sync_hxb_node_web_%TAG%
echo   URL: http://your-domain:23000
echo ==========================================
echo.
pause
