@echo off
chcp 65001 >nul
title AI Girlfriend - Запуск ^| Твоя девушка рядом 💜
color 0d
setlocal EnableDelayedExpansion

echo.
echo  ======================================================
echo   💜 AI GIRLFRIEND - Твоя девушка всегда рядом
echo  ======================================================
echo.

:: Переходим в папку где лежит batник (там же index.html)
cd /d "%~dp0"

:: ---------------------------------------------------------
:: 1. ПРОВЕРКА PYTHON (если есть - пропускаем установку)
:: ---------------------------------------------------------
echo [1/3] Проверяю Python...

:: Проверяем python, python3, py
where python >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PY_VER=%%i
    echo   ✓ Найден: !PY_VER!
    set PYTHON_CMD=python
    goto :python_ok
)

where py >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('py --version 2^>^&1') do set PY_VER=%%i
    echo   ✓ Найден: !PY_VER! ^(py launcher^)
    set PYTHON_CMD=py
    goto :python_ok
)

where python3 >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('python3 --version 2^>^&1') do set PY_VER=%%i
    echo   ✓ Найден: !PY_VER!
    set PYTHON_CMD=python3
    goto :python_ok
)

echo   ✗ Python не найден. Сейчас скачаю и установлю...
echo.

:: ---------------------------------------------------------
:: 2. СКАЧИВАНИЕ И УСТАНОВКА PYTHON
:: ---------------------------------------------------------
set PY_URL=https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe
set PY_INSTALLER=%TEMP%\python-ai-girlfriend-installer.exe

echo [2/3] Скачиваю Python 3.12.7...
echo   URL: %PY_URL%
echo   Это займет ~25 МБ, подожди...

:: Пробуем через PowerShell, если есть
powershell -Command "& {try { Invoke-WebRequest -Uri '%PY_URL%' -OutFile '%PY_INSTALLER%' -UseBasicParsing; exit 0 } catch { exit 1 }}" >nul 2>&1
if %errorlevel% neq 0 (
    echo   Пробую через curl...
    curl -L -o "%PY_INSTALLER%" "%PY_URL%" >nul 2>&1
)

if not exist "%PY_INSTALLER%" (
    echo.
    echo   ╔══════════════════════════════════════════════════╗
    echo   ║  ❌ Не получилось скачать Python автоматически  ║
    echo   ║  Скачай вручную:                               ║
    echo   ║  https://www.python.org/downloads/             ║
    echo   ║  При установке ОБЯЗАТЕЛЬНО поставь галочку     ║
    echo   ║  [x] Add python.exe to PATH                    ║
    echo   ╚══════════════════════════════════════════════════╝
    echo.
    pause
    exit /b 1
)

echo   ✓ Скачано. Устанавливаю...
echo   ^(Окно установки может попросить разрешение администратора^)

:: Тихая установка: для всех пользователей, добавить в PATH
"%PY_INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0 >nul 2>&1

:: Ждем 15 сек пока установится
echo   Жду завершения установки...
timeout /t 15 /nobreak >nul

:: Обновляем PATH для текущей сессии
set "PATH=%PATH%;C:\Python312;C:\Python312\Scripts;C:\Program Files\Python312;C:\Program Files\Python312\Scripts;%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts"

:: Проверяем снова
where python >nul 2>&1
if %errorlevel%==0 (
    set PYTHON_CMD=python
    goto :python_ok
)
where py >nul 2>&1
if %errorlevel%==0 (
    set PYTHON_CMD=py
    goto :python_ok
)
if exist "C:\Python312\python.exe" set PYTHON_CMD=C:\Python312\python.exe
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python312\python.exe

:: Если все еще не найден - просим перезапустить bat
if not defined PYTHON_CMD (
    echo.
    echo   ✓ Python установлен! Перезапусти этот файл еще раз.
    echo   ^(Нужно чтобы обновился PATH^)
    del "%PY_INSTALLER%" >nul 2>&1
    pause
    exit /b 0
)

:python_ok
echo.
for /f "tokens=*" %%i in ('%PYTHON_CMD% --version 2^>^&1') do echo   Использую: %%i ^(%PYTHON_CMD%^)
echo.

:: ---------------------------------------------------------
:: 3. ЗАПУСК СЕРВЕРА
:: ---------------------------------------------------------
echo [3/3] Запускаю сервер...

:: Проверяем есть ли index.html
if not exist "index.html" (
    echo   ❌ Не найден index.html в папке %cd%
    echo   Положи batник рядом с index.html и avatar.jpg
    pause
    exit /b 1
)

:: Ищем свободный порт, пробуем 8000, если занят - 8001, 8002...
set PORT=8000
:find_port
netstat -ano | findstr ":%PORT% " >nul 2>&1
if %errorlevel%==0 (
    echo   Порт %PORT% занят, пробую %PORT%+1...
    set /a PORT+=1
    if !PORT! gtr 8010 (
        echo   ❌ Не нашел свободный порт 8000-8010
        pause
        exit /b 1
    )
    goto :find_port
)

echo   Порт: %PORT%
echo   Папка: %cd%
echo.

:: Запускаем сервер в фоне
echo   Запускаю: %PYTHON_CMD% -m http.server %PORT%
start "AI Girlfriend Server" /min cmd /c "%PYTHON_CMD% -m http.server %PORT% --bind 127.0.0.1"

:: Ждем пока сервер поднимется
echo   Жду запуска сервера...
timeout /t 2 /nobreak >nul

:: Проверяем 3 раза
set TRIES=0
:check_server
set /a TRIES+=1
powershell -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto :server_ok
if %TRIES% lss 4 (
    timeout /t 1 /nobreak >nul
    goto :check_server
)
echo   ⚠ Сервер долго запускается, но пробую открыть браузер все равно...

:server_ok
echo   ✓ Сервер запущен!
echo.

:: ---------------------------------------------------------
:: 4. ОТКРЫВАЕМ БРАУЗЕР
:: ---------------------------------------------------------
set URL=http://localhost:%PORT%/
echo   Открываю браузер: %URL%
echo.

:: Пробуем открыть через start
start "" "%URL%"

:: Также пробуем через explorer
timeout /t 1 /nobreak >nul
if %errorlevel% neq 0 start explorer "%URL%"

echo  ======================================================
echo   ✅ ГОТОВО! Твоя девушка ждет тебя в браузере 💜
echo  ======================================================
echo.
echo   Сайт: %URL%
echo   Чтобы остановить сервер — закрой это окно или нажми Ctrl+C в окне сервера
echo.
echo   Подсказки:
echo   - В настройках ^(шестеренка^) можно поменять ей имя и характер
echo   - Прогресс сохраняется сам, даже если закрыть браузер
echo   - Кнопка "Очистить переписку" - начать заново
echo.
echo   Не закрывай это окно пока общаешься!
echo.
pause
exit /b 0
