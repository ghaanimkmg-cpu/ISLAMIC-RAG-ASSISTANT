@echo off
echo ========================================================
echo       ZaryahPlus - Islamic Knowledge Assistant
echo ========================================================
echo.

echo [1/3] Starting FastAPI Backend on port 8001...
start "Backend Server" cmd /k "cd backend && call ..\.venv\Scripts\activate && pip install -r requirements.txt && python -m uvicorn main:app --host 127.0.0.1 --port 8001"

echo [2/3] Starting Frontend Server on port 3000...
start "Frontend Server" cmd /k "cd frontend && python -m http.server 3000"

echo [3/3] Waiting for servers to spin up...
timeout /t 3 /nobreak > nul

echo Opening the application in your default browser...
start http://localhost:3000

echo.
echo All done! Close this window when you are finished.
echo Leave the two new server windows open to keep Raya running.
pause > nul
