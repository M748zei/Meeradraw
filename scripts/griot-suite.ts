/**
 * Suite de tests Griot — construite à l'étape 3 (moteur de récits).
 * Placeholder volontairement explicite : 0 test = échec, pour que la CI ne
 * puisse jamais passer au vert sur une suite vide par accident.
 */
console.log("[griot-suite] suite en construction — aucun test enregistré.");
if (!process.env.GRIOT_SUITE_ALLOW_EMPTY) {
  console.error("[griot-suite] échec volontaire : la suite est vide.");
  process.exit(1);
}
