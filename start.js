'use strict';

// Punto de entrada: primero recupera los datos guardados en la base (si hay DATABASE_URL) y luego arranca el bot.
(async () => {
  const db = require('./dbstore');
  try {
    await Promise.race([
      db.restore(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo agotado leyendo la base')), 25000)),
    ]);
  } catch (e) {
    db.abort();
    console.log('[datos] no se pudo leer la base (' + e.message + '): se arranca solo con el disco local y NO se escribirá en la base');
  }
  require('./server.js');
})();
