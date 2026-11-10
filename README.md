# Bot Antiraid + Minijuegos (con panel de activación)

Un solo programa que hace dos cosas:

1. **Panel web** donde pegas el **token** y el **ID** del bot y lo activas. Se mantiene en línea solo (reconexión automática, vigilante, arranque automático).
2. **El bot**: antiraid completo, moderación, logs por tipo, bienvenidas/despedidas, minijuegos y economía.

## Antiraid (automático)

| Módulo | Qué hace |
|---|---|
| **Anti bot-add** | Si alguien añade un bot que no es de confianza: banea al bot y a quien lo añadió, y lo registra. **Nunca** banea a un bot añadido por el dueño del servidor, por el creador del bot o por un usuario de la whitelist (y ese bot pasa solo a la lista de bots de confianza), ni a un bot que ya esté en la whitelist. Si no puede leer el registro de auditoría para saber quién lo añadió, **no banea a ciegas**: avisa en el log (da al bot el permiso «Ver registro de auditoría»). |
| **Anti oleada de ingresos** | Si entran N cuentas en pocos segundos: activa *modo raid*, sanciona a los que entraron y pausa las invitaciones. |
| **Edad mínima de cuenta** | Rechaza cuentas demasiado nuevas (configurable). |
| **Anti-nuke** | Si alguien borra/crea canales o roles, banea o expulsa en masa: lo banea (o le quita los roles peligrosos). |
| **Anti spam / menciones masivas / invitaciones** | Aísla al infractor y borra los mensajes. |
| **Modo pánico** | `/panic on` activa el modo raid manualmente. |
| **Whitelist** | Usuarios de confianza y bots permitidos (`/antiraid whitelist`). |

El dueño del servidor, el creador del bot (`BOT_OWNER_IDS` o el dueño de la aplicación en Discord), el propio bot y los usuarios y bots de la whitelist nunca son sancionados.

## Comandos

- **Protección:** `/antiraid status|toggle|tune|whitelist`, `/panic`, `/logs add|remove|list`, `/welcome`, `/goodbye`
- **Moderación:** `/purge`, `/lock`, `/unlock`, `/isolate`, `/ban`, `/kick` — y con prefijo: `!purge`, `!lock`, `!unlock`, `!aislamiento`
- **Desbanear:** `/unban` (en español `/desbanear`): al escribir en `usuario` sale la lista de baneados (busca por nombre, ID o motivo; también vale pegar un ID o una mención) y `motivo` es opcional. Hace falta el permiso «Banear miembros» (tanto para quien lo usa como para Centinela); queda en el registro de moderación. También con prefijo (`$unban <id>`) y desde el panel web (Gestionar servidor → Baneos).
- **Juegos y economía:** `/coinflip` `/dice` `/rps` `/slots` `/hilo` `/trivia` `/tictactoe` `/8ball` · `/daily` `/work` `/balance` `/leaderboard`
- **Info:** `/serverinfo` `/userinfo` `/ping` `/help`

**Banner del bot.** Al conectar, si el bot todavía no tiene banner puesto (ni a mano desde Discord ni de un arranque anterior), Centinela se pone uno propio (dibujado en `banner.js`, mismo estilo que las tarjetas de bienvenida). Los bots pueden tener banner sin Nitro. Si ya tiene uno, no lo toca; para cambiarlo, se quita desde Discord (perfil de la app → Banner) y se reconecta.

Los comandos y mensajes se muestran en **español o inglés** según el idioma del cliente de Discord de cada persona.

**Torneos de simulación (`/torneo`)**: monta una liga o una Champions con los clubes del servidor. `/torneo crear tipo:Liga|Champions [nombre]` abre las inscripciones con un panel público. Cualquiera puede pulsar **📝 Inscribir club**: elige el rol de su club y su 11 titular entre los miembros que ya tienen ese rol (son los «jugadores disponibles» del club); sale en el panel con el club y quién lo inscribió. Un club solo se inscribe una vez, y cada persona inscribe como mucho un club (hasta 16 clubes por torneo). Cuando haya al menos 2, quien creó el torneo pulsa **▶️ Empezar**: en **Liga** se juegan todos contra todos, jornada a jornada (con **⚽ Siguiente** se simula la que toca); en **Champions** es eliminatoria directa (con descansos si el número de clubes no es potencia de 2). Los partidos se simulan al azar (es eso, una simulación, no hay estadísticas reales de por medio); cada jornada o ronda, Centinela crea una categoría con un canal por enfrentamiento (se borran los de la ronda anterior al pasar a la siguiente) y en el canal del torneo deja los enlaces a cada uno. Al terminar sale el campeón y se vota un **🥇 Balón de Oro** entre los 11 titulares de todos los clubes inscritos. `/torneo cancelar` lo cancela (quien lo creó, el dueño del servidor o quien tenga Gestionar servidor).

**Verificación (`/verify setup` o `/verificar setup`)**: la verificación de nuevos miembros se hace en la web, no con una pregunta de matemáticas. El comando crea (si no le pasas uno) un rol **Verificado** y un canal **verificacion**, deja ese canal visible para todo el mundo (sin poder escribir) y el resto solo para quien tenga el rol — todo automático, sin tocar permisos a mano. El panel que publica tiene un botón que lleva a la web: ahí se entra con Discord y, al pulsar **Verificarme**, se concede el rol y se muestra la lista de canales ya disponibles. `/verify off` lo desactiva. También se puede activar desde el panel web (módulo «Verificación» en Ajustes), que hace lo mismo automáticamente al activarlo.

**Bienvenidas y despedidas:** `/bienvenida` y `/despedida` (o el panel de `/help` → Ajustes). Basta con elegir `channel:` para que se activen; `image:` pone la imagen con avatar, nombre y un texto (`image_text:`, con `{user}` `{username}` `{server}` `{count}`) y `test:true` manda una prueba al instante y dice qué falla (permisos «Enviar mensajes» / «Adjuntar archivos», canal borrado…). La imagen usa las fuentes de `fonts/` (el contenedor no trae ninguna) y al arrancar el registro dice `[tarjeta] imagen de bienvenida OK`.

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

Comandos slash extra: `/hacer` (el dueño o cualquier Administrador; guarda una copia, **borra todos los canales y roles** y construye el servidor completo según el tipo elegido, con permisos, normas, tickets, roles por botones, antiraid y el juego de camisetas) y `/setchannel` `/coleccion` `/intercambio` `/ajustes` (camisetas). `/enviarmensaje` (Administrador): abre un cuadro para escribir el mensaje (admite formato de Discord, enlaces, `{user}`/`{server}` y un botón con enlace), enseña la vista previa y, al confirmar, lo manda por MD a todos los miembros despacio (≈2 s por persona, se frena solo si Discord lo pide), con botón de parar e informe final por MD. Llega como un **mensaje normal** (sin recuadro/embed) que empieza con el nombre del servidor en negrita; máx. 1700 caracteres. Discord siempre enseña el perfil del propio bot en los MD, así que la foto y el nombre del servidor no se pueden cambiar por servidor. Si algo queda a medias (canal o rol borrado, panel sin publicar, canal de reglas vacío…) el bot menciona al dueño con una «💡 Sugerencia».

**`/enviarmensaje` como app externa (solo el creador del bot).** El bot activa solo el tipo de instalación «usuario» (Developer Portal → Installation → Install Contexts → *User Install*; si Discord no lo deja por API, se marca a mano y el registro lo avisa). Después, en el panel (Tus servidores → «📲 Instalar en mi cuenta») el creador lo instala en su cuenta y puede usar `/enviarmensaje` en cualquier servidor, chat de grupo o MD aunque el bot no esté dentro. En esos sitios Discord no deja que el bot vea a los miembros ni les escriba por MD, así que escribes el mensaje (formato, enlaces y botón), ves la vista previa y se **publica como mensaje normal en el canal donde lo uses** (sin menciones masivas). Dentro de los servidores del bot, el administrador sigue mandando el MD a todos los miembros como antes.

`/hacer` construye primero todo lo nuevo y borra lo viejo al final (así un reinicio a mitad nunca te deja el servidor vacío; los roles y canales viejos con el mismo nombre no se reutilizan) y deja en los registros líneas `[hacer]` / `[plantilla]` con lo que va haciendo.

**Plantillas de servidor (45).** Se eligen en `/hacer tipo` (escribe para buscar: `liga`, `boxeo`, `nba`…), con `$plantilla` o en el panel web (con buscador). Las generales son comunidad, gaming, Minecraft, estudio, tienda, anime, creador, roleplay, proyecto (la comunidad pública de UN proyecto/app/bot: changelog, bugs, sugerencias) y **equipo de proyectos** (espacio interno para un equipo que lleva VARIOS proyectos a la vez: ideas, tareas, un canal por proyecto, roles por área y reuniones de voz). Las deportivas (`templates_deportes.js`) llevan un rol con el color del equipo y un canal por equipo, más jornada, tácticas, quiniela, fantasy y salas de voz; las de fútbol llevan también un canal de torneos para `/torneo`:
- **Ligas de fútbol:** LaLiga, Premier League, Serie A, Bundesliga, Ligue 1, Liga MX, Liga Profesional Argentina, Brasileirão, Primeira Liga, Eredivisie, Saudi Pro League y MLS.
- **Fútbol en general:** Champions League / Europa, Selecciones y Mundial, Fútbol (todas las ligas), tu propia liga o torneo y EA FC.
- **Otros deportes:** boxeo (una categoría de peso por rol y federaciones), MMA/UFC, lucha libre, NBA, baloncesto, NFL (32 canales de equipo), béisbol, Fórmula 1, MotoGP, tenis, ciclismo, rugby, golf, pádel, running, gimnasio, esports y «todos los deportes».
Las listas de equipos están en `templates_deportes.js` (se cambian en un momento al empezar una temporada). Los paneles de roles por botones admiten hasta 25 roles (20 con reacciones).

El comando principal es `/help`: abre un menú con la tabla de comandos y funciones, **Instalar** (módulos como RaidProtect), **Ajustes** (valores y filtros por módulo), **Estado** y **Reportar**. Los comandos con prefijo siguen disponibles. Los minijuegos (`games.js`) ya no se registran como slash.

## Panel web completo

`/dashboard.html` permite configurar todos los módulos de cada servidor desde el navegador: instalar, activar/desactivar, valores, filtros, canales, roles y autoroles.

**🛠️ Gestionar servidor (`manage.js`).** En el menú de cada servidor, «Gestionar servidor» deja hacer desde la web lo mismo que harías en Discord:
- **Miembros:** buscar por nombre o ID, dar y quitar roles (etiquetas con ×), expulsar y banear (con motivo).
- **Roles y Canales:** listas con buscador y casillas para borrar varios de una vez; en Canales, opción de borrar también lo que hay dentro de una categoría. Los que no se pueden salen con 🔒 y el motivo (rol de otro bot, por encima del rol de Centinela, canal obligatorio de la comunidad…).
- **Baneos:** ver y buscar baneados, desbanear y banear por ID (aunque la persona no esté en el servidor), con opción de borrar sus mensajes de 1 o 7 días.
- **🔗 Invitación:** en «Tus servidores», cada servidor lleva un botón 🔗: crea la invitación del servidor (permanente, sin límite de usos; Discord reutiliza una igual si ya existe), la copia al portapapeles y la enseña con «Copiar» y «Abrir». Entra por el canal de reglas o por uno que vea todo el mundo. Hace falta «Crear invitación» (tú, con tus permisos reales, y Centinela; las invitaciones nuevas de Centinela ya lo piden). Se puede revocar en Discord → Ajustes del servidor → Invitaciones.

Reglas: el panel **nunca da más poder del que ya tienes en Discord**. El dueño del servidor puede con todo lo que el propio bot pueda; los demás (también el creador del bot) necesitan el permiso real (Banear / Expulsar / Gestionar roles / Gestionar canales) y un rol por encima del miembro o rol afectado, así que el creador del bot no puede usar esto en servidores ajenos donde no tenga permisos. Además hay que cumplir lo de siempre del panel (con «máxima seguridad» solo entran el dueño y la lista de confianza). No se puede banear al dueño, a Centinela ni a uno mismo. Las acciones llevan el motivo `Panel web · nombre (id)` en el registro de auditoría de Discord, se anotan en el registro de moderación (`/logs add mod`) y, como las hace el propio Centinela (que es de confianza), no activan el anti-nuke. Las peticiones que no salgan del propio panel se rechazan. Para que funcione, el rol de Centinela debe estar **por encima** de los roles que quieras gestionar y tener Gestionar roles / canales y Banear miembros.

## Funciones extra

Palabras prohibidas, tickets (botón → canal privado), roles por botones, niveles (`$rank`, `$top`) y autoroles. Se configuran en `/help` → Ajustes o en `/panel/dashboard.html`.

`/guía` muestra un panel con todos los comandos con prefijo, por categorías.

## Login con Discord (configurar desde la web)

Se entra con «Login with Discord» (flujo implícito, sin secreto). Al arrancar, Centinela intenta registrar solo las redirecciones que necesita (`/auth/callback` para el panel y `/verify/callback` para la verificación web de miembros); si Discord no lo deja con el token del bot, lo avisa en el registro y hay que añadirlas a mano en el Developer Portal → OAuth2 → Redirects.

El dueño del bot (o los IDs en `BOT_OWNER_IDS`) entra como administrador: ve todos los servidores y abre `/panel` (token e ID). Los demás ven solo sus servidores. Si aún no hay token configurado, `/panel` pide usuario `admin` + `PANEL_PASSWORD` una sola vez.

## Voz

`/putbot` mete al bot en tu canal de voz; hablas y responde en voz alta. `/setidioma` elige el idioma (es, en, pt, fr, de, it, ja). Necesita en el hosting una clave: `GROQ_API_KEY` (gratis, sirve para oír y pensar) u `OPENAI_API_KEY`; opcional `ANTHROPIC_API_KEY` para que piense con Claude. El bot necesita permisos Conectar y Hablar.
