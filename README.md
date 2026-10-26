# Liguita de tenis

Web de la liga: clasificación en directo, partidos confirmados por correo, estadísticas y panel de admin.

## Subirla a Netlify (proyecto liguita-tenis-bcn)

1. En Netlify > liguita-tenis-bcn > Project configuration > Environment variables, añade:
   - GMAIL_USER = el Gmail de la liga (ej. liguitatenis@gmail.com)
   - GMAIL_APP_PASSWORD = contraseña de aplicación de ese Gmail (myaccount.google.com/apppasswords, requiere verificación en 2 pasos)
2. Abre una terminal en esta carpeta y ejecuta:
   npm install
   npx netlify-cli deploy --build --prod --site 64874728-5523-4095-89b0-4930d62ee3ed
   (la primera vez te pide iniciar sesión en Netlify en el navegador)
3. Entra en la web con albertodoradopo@gmail.com, ve a Admin y pon los correos de todos.
4. En Admin, "Enviarme correo de prueba" para comprobar que salen los mails.

Si cambias las variables de entorno, vuelve a ejecutar el paso 2.

## Qué hace sola
- Cada hora: confirma partidos sin respuesta en 48 h y cierra votaciones de más de 72 h.
- Lunes por la mañana: resumen semanal a todos.

## Tests
npm test
