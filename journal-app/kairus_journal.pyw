# Abre Kairus Journal sin ventana negra (se abre con pythonw.exe).
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.chdir(HERE)

import journal_app  # noqa: E402

if __name__ == "__main__":
    journal_app.main()
