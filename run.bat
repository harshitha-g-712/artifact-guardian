@echo off
echo Starting Artifact Guardian...
call venv\Scripts\activate 2>nul || python -m venv venv && call venv\Scripts\activate
pip install -r requirements.txt --quiet
python app.py
pause
