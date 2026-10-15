# Bot Antiraid + Minijuegos (con panel de activación)

Un solo programa que hace dos cosas:

1. **Panel web** donde pegas el **token** y el **ID** del bot y lo activas. Se mantiene en línea solo (reconexión automática, vigilante, arranque automático).
2. **El bot**: antiraid completo, moderación, logs por tipo, bienvenidas/despedidas, minijuegos y economía.

## Antiraid (automático)

| Módulo | Qué hace |
|---|---|
| **Anti bot-add** | Si alguien añade un bot que no está en la lista blanca: banea al bot y a quien lo añadió, y lo registra. |
| **Anti oleada de ingresos** | Si entran N cuentas en pocos segundos: activa *modo raid*, sanciona a los que entraron y pausa las invitaciones. |
| **Edad mínima de cuenta** | Rechaza cuentas demasiado nuevas (configurable). |
| **Anti-nuke** | Si alguien borra/crea canales o roles, banea o expulsa en masa: lo banea (o le quita los roles peligrosos). |
| **Anti spam / menciones masivas / invitaciones** | Aísla al infractor y borra los mensajes. |
| **Modo pánico** | `/panic on` activa el modo raid manualmente. |
| **Whitelist** | Usuarios de confianza y bots permitidos (`/antiraid whitelist`). |

El dueño del servidor, el propio bot y los usuarios de la whitelist nunca son sancionados.

## Comandos

- **Protección:** `/antiraid status|toggle|tune|whitelist`, `/panic`, `/logs add|remove|list`, `/welcome`, `/goodbye`
- **Moderación:** `/purge`, `/lock`, `/unlock`, `/isolate`, `/ban`, `/kick` — y con prefijo: `!purge`, `!lock`, `!unlock`, `!aislamiento`
- **Juegos y economía:** `/coinflip` `/dice` `/rps` `/slots` `/hilo` `/trivia` `/tictactoe` `/8ball` · `/daily` `/work` `/balance` `/leaderboard`
- **Info:** `/serverinfo` `/userinfo` `/ping` `/help`

Los comandos y mensajes se muestran en **español o inglés** según el idioma del cliente de Discord de cada persona.

**Logs por tipo:** `raid`, `mod`, `welcome`, `goodbye`. Puedes poner varios canales por tipo o solo uno (`/logs add`). Si no hay canal de raid configurado, el dueño recibe los avisos por mensaje directo.

## Antes de activar: Developer Portal

En **discord.com/developers → tu aplicación → Bot** activa:
- **Server Members Intent** (obligatorio para detectar ingresos y bots nuevos)
- **Message Content Intent** (para antispam, invitaciones y comandos con `!`)

Si no los activas, el bot arranca en *modo limitado* y el panel te lo avisa.

Después de invitarlo, **sube el rol del bot lo más arriba posible** en Ajustes del servidor → Roles. Si un rol de moderador está por encima del bot, no podrá sancionarlo. Pide permiso de *Ver registro de auditoría*: sin él no puede saber quién añadió un bot.

## Uso local

```bash
npm install
PANEL_PASSWORD=tu_clave npm start
```

Abre `http://localhost:3000` (usuario `admin`). Si no defines `PANEL_PASSWORD`, se genera una temporal y se imprime en la consola.

## Desplegar 24/7 (Railway, Render, VPS)

El bot está en línea **mientras el programa corra**, así que debe estar en un servidor siempre encendido.

- **Disco persistente:** guarda la configuración y la economía en `DATA_DIR` (por defecto `./data`). En Railway añade un *Volume* y apunta `DATA_DIR` a él; si no, se pierde al redesplegar.
- **Variables:** `PANEL_PASSWORD` (obligatoria), `PORT`, `DATA_DIR`. Opcionales para arrancar sin usar el panel: `BOT_TOKEN`, `BOT_ID`, `BOT_PRESENCE`, `BOT_ACTIVITY`.
- **Monitoreo:** `/health` responde sin contraseña, útil para UptimeRobot en planes que se duermen.
- Incluye `Dockerfile`.

## Seguridad

- El token se guarda en `data/config.json` (permisos 600) y **nunca** se envía al navegador.
- Usa una `PANEL_PASSWORD` fuerte y sirve el panel por HTTPS.
- Si el token se compartió en algún lugar público, reinícialo en el Developer Portal (Bot → Reset Token).

## Web y panel

- `/` — web pública de Centinela (características, explorador de comandos, guía de instalación).
- `/panel` — panel privado (usuario `admin`, clave `PANEL_PASSWORD`) para poner el token y el ID.
- `/api/public` — estado y lista de comandos; `/health` — healthcheck.

## Comandos estilo RB3 Guard / XN Protect

Prefijo `$` (cambia con `$setprefix`) y slash `/`: `autosetup`, `config show`, `settings`, `check`, `whitelist`, `b-create`, `b-load`, `b-auto`, `verify`, `help` y más. Primer uso: sube el rol del bot, ejecuta `$autosetup` y luego `$check`.

## Panel dentro de Discord

El único comando slash es `/help`: abre un menú con la tabla de comandos y funciones, **Instalar** (módulos como RaidProtect), **Ajustes** (valores y filtros por módulo), **Estado** y **Reportar**. Los comandos con prefijo siguen disponibles. Los minijuegos (`games.js`) ya no se registran como slash.

## Panel web completo

`/panel/dashboard.html` (misma contraseña) permite configurar todos los módulos de cada servidor desde el navegador: instalar, activar/desactivar, valores, filtros, canales, roles y autoroles.

## Funciones extra

Palabras prohibidas, tickets (botón → canal privado), roles por botones, niveles (`$rank`, `$top`) y autoroles. Se configuran en `/help` → Ajustes o en `/panel/dashboard.html`.
