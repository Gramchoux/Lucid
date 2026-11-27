// Lucid — main.js : Démarrage (chargé en dernier).

// ------------------------------------------------------------------ démarrage
applySettings();
if (SETTINGS.clipboard()) setTimeout(clipboardWatch, 3000);  // reprend l'écoute si elle était activée
pollStatus();
route();
