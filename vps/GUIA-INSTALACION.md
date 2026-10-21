# Guía: instalar el lector del journal en el VPS (Windows)

Esto se hace una sola vez. Tiempo aproximado: 30 minutos.

## 1. Entrar al VPS
1. Abre **Conexión a Escritorio remoto** en tu computador.
2. Escribe la IP del VPS, el usuario (normalmente `Administrator`) y la contraseña que te dio el proveedor.

## 2. Instalar los dos MetaTrader 5
1. Desde el VPS, descarga el MT5 de **Exness** (desde tu área personal de Exness) e instálalo.
2. Descarga el MT5 de **Funding Pips** (desde su panel) e instálalo **en otra carpeta**.
3. Abre cada uno una vez, inicia sesión con cualquier cuenta tuya del bróker y ciérralo. Así queda guardada la lista de servidores.
4. Anota la ruta de cada `terminal64.exe`. Por ejemplo:
   - `C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe`
   - `C:\Program Files\FundingPips MT5 Terminal\terminal64.exe`

## 3. Instalar Python
1. Descarga Python 3.12 para Windows desde python.org.
2. En el instalador marca **"Add python.exe to PATH"** y dale Install.

## 4. Copiar el programa
1. Crea la carpeta `C:\journal`.
2. Copia ahí `journal_sync.py` y `requirements.txt` (la carpeta `vps` del repositorio).
3. Abre **PowerShell**, escribe y presiona Enter:
   ```
   cd C:\journal
   pip install -r requirements.txt
   ```

## 5. Guardar la configuración privada
En PowerShell, cambia lo que está entre comillas por tus datos y presiona Enter en cada línea. **No los compartas con nadie, ni por el chat.**
```
setx SUPABASE_SERVICE_KEY "la-service-key-de-supabase"
setx JOURNAL_KEY "la-misma-frase-que-pusiste-en-vercel"
setx MT5_PATH_EXNESS "C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe"
setx MT5_PATH_FUNDINGPIPS "C:\Program Files\FundingPips MT5 Terminal\terminal64.exe"
setx EXNESS_PARTNER_EMAIL "tu-correo-de-partner"
setx EXNESS_PARTNER_PASSWORD "tu-contraseña-de-partner"
```
Cierra PowerShell y vuelve a abrirlo para que tome los cambios.

## 6. Probar una vez
```
cd C:\journal
python journal_sync.py --once
```
Al final debe salir una línea `OK ...` por cada cuenta. Si sale un error, copia lo que dice y mándalo al chat. Los errores no muestran contraseñas.

## 7. Dejarlo prendido siempre
1. Abre el **Programador de tareas** de Windows y elige **Crear tarea básica**.
2. Nombre: `Journal Mr Katana`. Desencadenador: **Al iniciar la sesión**.
3. Acción: **Iniciar un programa**. Programa: `python`. Argumentos: `journal_sync.py`. Iniciar en: `C:\journal`.
4. Para salir del VPS, cierra la ventana del Escritorio remoto con la **X**. **No uses "Cerrar sesión"**: MetaTrader necesita que la sesión siga abierta para funcionar.

Desde ese momento revisa todas las cuentas cada hora. El registro queda en `C:\journal\journal_sync.log`.
