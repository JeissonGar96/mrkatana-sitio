# Kairus Journal: guía de instalación en el VPS

Reemplaza la ventana negra (cmd) del `journal_sync.py`. Se hace una sola vez, unos 30 minutos.

**Regla de oro:** la app solo usa los MT5 que están dentro de `C:\Journal`. Tu MT5 de Exness con la cuenta real, tu MT5 de Funding Pips y el MT5 del bot (`C:\Kairus\MT5`) no se tocan nunca. Si alguien pone una de esas rutas en la configuración, la app se niega a usarla.

## 1. Apagar el sync viejo
1. Cierra la ventana negra (cmd) del journal.
2. Presiona `Windows + R`, escribe `shell:startup` y Enter. Borra `iniciar.bat` de esa carpeta (así no vuelve a abrirse al reiniciar).
3. No borres `C:\journal`: queda como respaldo.
4. El sync viejo dejaba cuentas de alumnos abiertas en tus MT5 de Program Files. Abre tus MT5 personales y vuelve a entrar con tus cuentas si hace falta. Desde ahora nadie los mueve.

## 2. Crear los MT5 del Journal (copias portables)
1. Crea la carpeta `C:\Journal`.
2. **Exness:** copia la carpeta `C:\Program Files\MetaTrader 5 EXNESS` y pégala dentro de `C:\Journal`. Cámbiale el nombre a `EX-1`.
3. **Funding Pips:** copia `C:\Program Files\MetaTrader 5` y pégala dentro de `C:\Journal`. Cámbiale el nombre a `FP-1`.
   (Copiar no cambia nada en tus MT5 originales.)
4. Abre cada copia en modo portable: `Windows + R`, escribe
   `C:\Journal\EX-1\terminal64.exe /portable` y Enter.
5. En ese MT5: **Archivo → Iniciar sesión en cuenta de trading**, entra con cualquier cuenta de ese bróker (una demo tuya sirve). Así la copia aprende la lista de servidores. Ciérralo.
6. Repite los pasos 4 y 5 con `C:\Journal\FP-1\terminal64.exe /portable`.

Con las cuentas de hoy basta con una copia por bróker. Cuando pasen de unas 40 cuentas, copia `C:\Journal\FP-1` como `FP-2` (o `EX-1` como `EX-2`) y agrégala en la configuración (paso 4). Cada copia usa unos 250 MB de RAM.

## 3. Copiar la app
1. En el VPS, entra a GitHub con tu cuenta y descarga el ZIP del repositorio (botón verde **Code → Download ZIP**).
2. Abre el ZIP, entra a la carpeta `journal-app` y copia todo su contenido a `C:\Journal\app`.
3. Abre PowerShell y escribe:
   ```
   cd C:\Journal\app
   pip install -r requirements.txt
   ```
   (Son las mismas librerías de antes; probablemente diga que ya están instaladas.)

## 4. Configuración privada
1. En `C:\Journal\app`, copia `config.ejemplo.ini` y renombra la copia a `config.ini`.
2. Ábrelo con el Bloc de notas. Lo único obligatorio es la sección `[terminales]`, que ya trae `EX-1` y `FP-1` con las rutas del paso 2.
3. `service_key` y `journal_key`: si los dejas vacíos, la app usa los que ya guardaste antes en el VPS. Si prefieres, pégalos ahí. **No compartas este archivo con nadie, tampoco por el chat.**

## 5. Probar
1. Doble clic en `kairus_journal.pyw`.
2. Se abre la ventana **Kairus Journal**. Los MT5 del Journal se abren solos y minimizados.
3. En un minuto cada cuenta debe pasar a **● OK** (verde). Si alguna sale en rojo, la columna Error dice por qué. El botón **Ver log** muestra el detalle.

Botones:
- **Iniciar / Pausar:** arranca o detiene la sincronización.
- **Sincronizar ahora:** lee ya las cuentas que elijas en la tabla (o todas si no eliges ninguna).
- **Releer historial completo:** vuelve a leer todo el historial de las cuentas elegidas (por si algo quedó mal).
- **Ver log:** el registro de lo que está pasando.

Si cierras la ventana con la X, te pregunta antes, porque el Journal deja de actualizarse.

## 6. Que arranque sola
1. Doble clic en `poner-en-inicio.bat`. Crea un acceso directo en el Inicio de Windows y otro en el Escritorio.
2. Para salir del VPS, cierra el Escritorio remoto con la **X**. **No uses "Cerrar sesión"**: MetaTrader necesita la sesión abierta.

## Cómo trabaja (por si te preguntan)
- Cada MT5 del Journal es un trabajador en paralelo, con su propia fila de cuentas.
- Cuentas con operaciones abiertas o que operaron hoy: cada 5 minutos. Las demás: cada 45 minutos. Las cuentas nuevas o con contraseña nueva se leen en el siguiente minuto.
- Solo lee lo nuevo desde la última vez (más un margen), no todo el historial.
- Solo escribe en Supabase cuando algo cambió, para cuidar el plan gratis. Una vez por hora marca "Actualizado" en todas las cuentas sin cambios, con una sola escritura.
- Si una clave está mal o el servidor no responde, marca el error, sigue con la siguiente y reintenta en 15 minutos. Si un MT5 se pega más de 5 minutos, lo reinicia solo.
- También guarda depósitos y retiros (tabla `journal_transfers`).
- Las claves de inversor siguen cifradas en Supabase. La app las descifra solo en memoria, en el momento de entrar.
