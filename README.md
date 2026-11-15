# Ultimate Team — bot de Discord

Bot público de Discord, completamente en español, para organizar clubes, fichajes y
temporadas de fútbol entre los miembros de un servidor. Construido con `discord.js` v14
(comandos slash, botones, menús desplegables y formularios/modales) y Postgres como base de
datos persistente (los datos no se pierden al reiniciar el bot).

## 1. Qué hace

- **Inscripción de clubes** mediante un panel con botón "Inscribirme" (no un comando manual),
  que abre un formulario para el nombre del club. Cada club empieza con 500 M de presupuesto.
  Un usuario no puede tener más de un club, y no se permiten nombres repetidos.
- **Catálogo de jugadores**: intenta traer datos de FUT-DB si hay `FUTDB_API_KEY` configurada;
  si no está disponible, usa un catálogo de 40 "cartas de prueba" claramente marcadas como tal
  (nunca se presentan como datos oficiales). Sincronizar el catálogo nunca borra jugadores ya
  fichados ni estadísticas de temporadas anteriores. Además, un administrador puede crear sus
  propias cartas a mano con `/crear-carta` (nombre, posición, estadísticas, precio y, si quiere,
  una imagen propia) para tener jugadores totalmente personalizados en el mercado.
- **Panel de fichajes** con tres flujos: "Fichaje libre" (agentes libres, gratis), "Comprar"
  (jugadores en venta, descuenta presupuesto) y "Rescindir" (solo tus propios jugadores,
  vuelven al mercado sin reembolso). Se elige posición y se navegan las cartas (con su imagen
  PNG) de una en una.
- **`/plantilla`**: presupuesto y plantilla agrupada por posición.
- **Temporadas**: `/temporada` genera Liga (todos contra todos) más Champions League y Europa
  League (el resto de clubes se reparte entre las dos, por sorteo). Hacen falta al menos 4
  clubes inscritos; si faltan, el bot dice cuántos hacen falta.
- **Partidos**: `/jugar` disputa el siguiente partido pendiente de tu club, publica el
  resultado con goleadores y asistencias (incluyendo en el canal configurado para resultados,
  si hay uno) y guarda las estadísticas.
- **`/tabla`** (clasificaciones de Liga/Champions/Europa League) y **`/premios`** (Balón de
  Oro, Bota de Oro, Guante de Oro y Club del Año de la última temporada cerrada).
- **`/finalizar-temporada`** (administradores, pide confirmación): calcula los premios y
  bloquea nuevos partidos de esa temporada.
- Canales configurables por función, acciones de administrador protegidas por el permiso
  "Gestionar servidor", y errores siempre traducidos a mensajes claros en español (nunca
  mensajes técnicos como "Missing Access").

## 2. Instalación

```bash
npm install
```

Variables de entorno (ver `.env.example`):

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Sí | Token del bot. **Nunca se debe pegar en un chat ni en este README**; se configura como Secret en el panel del host (Render → Environment). |
| `CLIENT_ID` | Sí | ID de la aplicación de Discord. |
| `DATABASE_URL` | Sí | Cadena de conexión a Postgres. El bot crea su propio esquema `ultimate_team` dentro de esa base de datos, así que puede convivir con otros proyectos en el mismo Postgres. |
| `FUTDB_API_KEY` | No | Clave de FUT-DB. Si falta o no es válida, el bot usa automáticamente el catálogo de cartas de prueba. |
| `FUTDB_BASE_URL` | No | URL base de FUT-DB, por si cambia (por defecto `https://futdb.app/api`). |
| `DEV_GUILD_ID` | No | ID de un servidor de pruebas para que los comandos se actualicen al instante ahí (además del registro global). |

Arranque:

```bash
npm start
```

Al arrancar, el bot prepara el esquema de la base de datos (`db.migrate()`) y registra sus
comandos slash automáticamente; no hace falta un paso de registro aparte.

## 3. Invitar el bot a un servidor

El bot es público y se puede invitar a cualquier servidor. Desde el
[portal de desarrolladores de Discord](https://discord.com/developers/applications), pestaña
**OAuth2 → URL Generator**, hay que marcar los scopes `bot` y `applications.commands`, y estos
permisos:

- Ver canales
- Enviar mensajes
- Insertar enlaces
- Adjuntar archivos

(permisos equivalentes al valor `52224`). Con la URL generada, cualquier administrador del
servidor puede añadir el bot.

**Importante sobre canales privados**: si el bot se usa en un canal privado o con permisos
restringidos, **un administrador del servidor debe darle acceso manualmente** a ese canal
concreto (ver canal, enviar mensajes, insertar enlaces y adjuntar archivos) desde los ajustes
de permisos del canal. Si al bot le falta alguno de esos permisos en un canal, no mostrará un
error técnico: explicará en español qué falta y qué debe hacer un administrador.

## 4. Comandos

| Comando | Quién | Qué hace |
|---|---|---|
| `/panel inscripciones` | Admin | Publica el panel de inscripción de clubes en el canal actual. |
| `/panel fichajes` | Admin | Publica el panel de fichajes (Fichaje libre / Comprar / Rescindir). |
| `/config canal tipo:<fichajes\|inscripciones\|partidos\|resultados> canal:<#canal>` | Admin | Define el canal usado para esa función. |
| `/config max-clubes cantidad:<n>` | Admin | Define el máximo de clubes inscribibles. |
| `/config inscripciones abiertas:<true/false>` | Admin | Abre o cierra las inscripciones. |
| `/actualizar-jugadores` | Admin | Sincroniza el catálogo de jugadores (FUT-DB o cartas de prueba). |
| `/crear-carta` | Admin | Crea a mano una carta de jugador personalizada (nombre, posición, valoración, estadísticas, precio e imagen opcional) y la añade al catálogo, sin depender de FUT-DB ni de las cartas de prueba. |
| `/temporada` | Admin | Inicia una nueva temporada (Liga + Champions + Europa League). |
| `/finalizar-temporada` | Admin | Cierra la temporada en curso (con confirmación) y calcula los premios. |
| `/plantilla` | Todos | Muestra tu presupuesto y tu plantilla. |
| `/jugar` | Todos | Disputa el siguiente partido pendiente de tu club. |
| `/tabla [competicion]` | Todos | Muestra las clasificaciones. |
| `/premios` | Todos | Muestra los premios de la última temporada cerrada. |

## 5. Qué se verificó realmente antes de entregar esto

Siguiendo la instrucción explícita de no afirmar que algo está probado sin haberlo verificado:

- **Verificado de verdad** (con una base de datos real ejecutándose en este entorno, corriendo
  el código tal cual, no una simulación en papel): inscripción de clubes (incluyendo rechazo de
  usuario duplicado, nombre duplicado y cupo máximo), sincronización del catálogo de cartas de
  prueba, fichaje libre (incluyendo que no se puede fichar dos veces al mismo agente libre),
  compra con presupuesto suficiente (se descuenta exactamente el precio) y compra sin
  presupuesto suficiente (se rechaza sin descontar nada), rescisión (sin reembolso, el jugador
  vuelve al mercado, no se puede rescindir lo que no es tuyo), que resincronizar el catálogo no
  borra ni desfícha jugadores ya fichados, generación de temporada (Liga + Champions/Europa,
  exige un mínimo de clubes), simulación de todos los partidos de una temporada hasta el final,
  que las estadísticas de goles de los jugadores cuadran exactamente con los marcadores,
  cálculo de los 4 premios mínimos al finalizar la temporada, y que finalizar una temporada
  libera el inicio de la siguiente.
- **Verificado solo a nivel de código** (revisión manual + comprobación de sintaxis de cada
  archivo), pero **no ejecutado de verdad contra Discord**: todo lo que depende de la propia
  interfaz de Discord (botones, menús, formularios, generación de las imágenes PNG de las
  cartas, mensajes de error traducidos). No tengo forma de abrir Discord y hacer clic en los
  botones yo mismo desde aquí.
- **No verificado todavía**: la integración real con FUT-DB (no encontré documentación pública
  verificable de ese servicio; el adaptador está escrito para fallar con elegancia y caer al
  catálogo de prueba si la API no responde como se espera, pero no he podido probarlo contra el
  servicio real).

Antes de dar por buena cualquiera de estas dos últimas partes, hace falta probarlas en un
servidor de Discord real.
