/**
 * Chantier 2 — la donnée de la planche de contrôle : pour chaque preset,
 * TROIS cas de test qui lui correspondent, et ses spécifications (ce qu'il
 * promet, sa lumière, son cadrage, sa distance au sujet, ce qui compte pour
 * le juger). Source unique : la planche HTML et docs/SPECS-PRESETS.md en
 * sortent tous les deux.
 */

export const PLANCHE = {
  // ── Portrait et identité ────────────────────────────────────────────────
  "portrait-pro": {
    specs: {
      promesse: "Une photo de profil qui inspire confiance sur LinkedIn/WhatsApp Business.",
      lumiere: "Fenêtre à 45°, douce, remplissage léger — jamais de flash dur.",
      cadrage: "Buste, 85 mm, posture détendue.",
      distance: "Proche : tête et épaules remplissent le cadre.",
      jugement: "Embaucherais-tu cette personne ? Peau naturelle, fond uni SANS décor, regard net.",
    },
    cas: [
      { personnages: [{ role: "une femme" }], textes: { fond: "gris-bleu", expression: "sourire confiant" } },
      { personnages: [{ role: "un homme d'âge mûr" }], textes: { fond: "vert sombre", expression: "regard sérieux" } },
      { personnages: [{ role: "une jeune femme voilée" }], textes: { fond: "beige", expression: "sourire doux" } },
    ],
  },
  "portrait-studio": {
    specs: {
      promesse: "L'énergie d'un shooting mode, fond coloré franc.",
      lumiere: "Flash déporté, ombres nettes assumées.",
      cadrage: "Buste, 85 mm, regard caméra, pose stylée.",
      distance: "Proche : buste plein cadre.",
      jugement: "Fond UNI saturé (zéro décor), contraste marqué, la personne a l'air d'une couverture de magazine.",
    },
    cas: [
      { personnages: [{ role: "un homme" }], textes: { fond: "jaune franc", expression: "rire franc" } },
      { personnages: [{ role: "une femme aux longues tresses" }], textes: { fond: "bleu roi", expression: "regard direct" } },
      { personnages: [{ role: "un jeune homme" }], textes: { fond: "rouge brique", expression: "bras croisés, sourire en coin" } },
    ],
  },
  "portrait-traditionnel": {
    specs: {
      promesse: "La matière des tissus à l'honneur — boubou, pagne, bijoux.",
      lumiere: "Latérale rasante qui sculpte le tissu, fond sombre.",
      cadrage: "Trois-quarts, la tenue visible jusqu'à la taille.",
      distance: "Moyenne : la tenue est le sujet autant que le visage.",
      jugement: "Peut-on sentir la broderie ? Le bazin brille-t-il juste ? Bijoux nets, fond qui disparaît.",
    },
    cas: [
      { personnages: [{ role: "une femme" }], textes: { tenue: "grand boubou bazin bleu nuit brodé" }, annee: 2020 },
      { personnages: [{ role: "un chef coutumier" }], textes: { tenue: "boubou blanc et chapeau conique" }, annee: 1965 },
      { personnages: [{ role: "une mariée" }], textes: { tenue: "pagne tissé kita et parure d'or" } },
    ],
  },
  "portrait-archive": {
    specs: {
      promesse: "Un visage qui traverse le temps — huile, clair-obscur.",
      lumiere: "Latérale chaude, l'autre moitié du visage dans l'ombre.",
      cadrage: "Buste, fond très sombre, vignettage.",
      distance: "Proche, mais picturale : on regarde un tableau, pas une photo.",
      jugement: "Coup de pinceau visible, dignité du modèle, aucun photoréalisme.",
    },
    cas: [
      { personnages: [{ role: "un homme" }], textes: { tenue: "boubou blanc" }, annee: 1960 },
      { personnages: [{ role: "une femme âgée" }], textes: { tenue: "foulard indigo" }, annee: 1930 },
      { personnages: [{ role: "un jeune tirailleur" }], textes: { tenue: "" }, annee: 1916 },
    ],
  },
  "avatar-illustre": {
    specs: {
      promesse: "Un avatar franc et graphique pour les réseaux.",
      lumiere: "Plate, les couleurs portent le volume.",
      cadrage: "Tête et épaules, fond à motif géométrique.",
      distance: "Proche, lisible en 40 px de large.",
      jugement: "Traits épais propres, silhouette lisible en miniature, motif de fond net.",
    },
    cas: [
      { personnages: [{ role: "une femme" }], textes: { fond: "motif wax orange" } },
      { personnages: [{ role: "un homme à lunettes" }], textes: { fond: "rayures kente" } },
      { personnages: [{ role: "une fillette" }], textes: { fond: "pois indigo" } },
    ],
  },
  "portrait-couple": {
    specs: {
      promesse: "La complicité, dans la vraie lumière de fin d'après-midi.",
      lumiere: "Contre-jour doux, halo chaud.",
      cadrage: "Plan taille, les deux penchés l'un vers l'autre.",
      distance: "Moyenne : les deux corps, le décor flou.",
      jugement: "Le lien se voit-il ? Halo doux sans surexposition, arrière-plan fondu.",
    },
    cas: [
      { personnages: [{ role: "un homme" }, { role: "une femme" }], textes: { tenues: "assortis en wax violet" } },
      { personnages: [{ role: "deux fiancés" }], textes: { tenues: "tenue de ville élégante" }, lieu: "Abidjan" },
      { personnages: [{ role: "un couple âgé" }], textes: { tenues: "boubous assortis" } },
    ],
  },

  // ── Commerce et boutique ────────────────────────────────────────────────
  "produit-fond-uni": {
    specs: {
      promesse: "Un packshot publicitaire : le produit roi, rien d'autre.",
      lumiere: "Boîte à lumière, ombre douce posée au sol.",
      cadrage: "Produit centré, 50 mm, fond dégradé uni.",
      distance: "Proche : le produit remplit la moitié du cadre.",
      jugement: "Fond réellement UNI (zéro figurant, zéro décor), netteté partout, ombre crédible.",
    },
    cas: [
      { textes: { produit: "un flacon d'huile de karité", couleur: "vert d'eau", support: "socle en bois" } },
      { textes: { produit: "une paire de sandales en cuir", couleur: "beige sable", support: "pierre plate" } },
      { textes: { produit: "un bocal de piment en poudre", couleur: "gris perle", support: "" } },
    ],
  },
  "produit-en-main": {
    specs: {
      promesse: "Le produit dans la vraie vie — tenu, posé, vivant.",
      lumiere: "Jour ombragé, doux, honnête.",
      cadrage: "Serré sur le produit, environnement animé mais flou.",
      distance: "Proche du produit, le monde en toile de fond.",
      jugement: "Le produit reste la star malgré la vie autour ; mains crédibles si présentes.",
    },
    cas: [
      { textes: { produit: "un pot de beurre de karité", couleur: "ambre", support: "tenu en main" } },
      { textes: { produit: "un sac en raphia tressé", couleur: "naturel", support: "posé sur l'étal" } },
      { textes: { produit: "une bouteille de bissap", couleur: "rouge sombre", support: "sur une table de maquis" } },
    ],
  },
  "vitrine-boutique": {
    specs: {
      promesse: "La boutique fière, l'enseigne peinte, la rue qui vit.",
      lumiere: "Plein soleil de fin de matinée.",
      cadrage: "Plan large de la façade entière.",
      distance: "Loin : toute la devanture dans le cadre.",
      jugement: "Donne-t-elle envie d'entrer ? Enseigne lisible et peinte à la main, rue vivante sans encombrer.",
    },
    cas: [
      { phrase: "Une devanture fraîchement repeinte, la gérante sur le pas de la porte", textes: { enseigne: "boutique de tissus" } },
      { phrase: "Un salon de coiffure aux murs turquoise, clients qui attendent", textes: { enseigne: "salon de coiffure" }, lieu: "Bamako" },
      { phrase: "Une boutique de téléphonie au carrefour, parasols devant", textes: { enseigne: "boutique de téléphonie" } },
    ],
  },
  "flyer-promo": {
    specs: {
      promesse: "Une affiche promo prête à recevoir TON texte en haut.",
      lumiere: "Frontale nette, couleurs publicitaires.",
      cadrage: "Sujet ancré en bas, TIERS SUPÉRIEUR VIDE.",
      distance: "Moyenne, le sujet punchy.",
      jugement: "Le tiers haut est-il réellement vide et calme ? Le sujet accroche-t-il en bas ?",
    },
    cas: [
      { phrase: "Une promo sur les perruques, mannequin souriante en bas de l'affiche", personnages: [{ role: "une mannequin" }] },
      { phrase: "Offre spéciale sur les pagnes, pile de tissus colorés en bas", objets: ["une pile de pagnes"] },
      { phrase: "Menu du jour du maquis, plat appétissant en bas de l'image", objets: ["un plat de riz sauce"] },
    ],
  },
  "equipe-bureau": {
    specs: {
      promesse: "Une équipe africaine moderne au travail, crédible pour un site ou un pitch.",
      lumiere: "Fenêtres larges, indirecte, corporate propre.",
      cadrage: "Plan moyen, plusieurs personnes en interaction.",
      distance: "Moyenne : l'équipe et le bureau ensemble.",
      jugement: "Bureau plausible (ni luxe SF ni cliché), postures engagées, matériel actuel.",
    },
    cas: [
      { phrase: "L'équipe en réunion autour d'un ordinateur portable", personnages: [{ role: "trois collègues" }] },
      { phrase: "Une développeuse présente un écran à ses collègues", lieu: "Dakar" },
      { phrase: "Deux associés signent un contrat dans un bureau lumineux" },
    ],
  },
  "plat-restaurant": {
    specs: {
      promesse: "L'assiette qui donne faim, vapeur comprise.",
      lumiere: "Latérale chaude, fond assombri.",
      cadrage: "Vue à 45° sur le plat, table en bois.",
      distance: "Très proche : la matière de la nourriture.",
      jugement: "A-t-on faim ? Vapeur visible, textures nettes, plat africain reconnaissable.",
    },
    cas: [
      { phrase: "Un thiéboudienne fumant servi dans un grand plat", textes: { plat: "thiéboudienne" } },
      { phrase: "Attiéké poisson braisé, citron et piment à côté", textes: { plat: "attiéké poisson braisé" } },
      { phrase: "Un plat de foufou sauce graine, cuillère en bois", textes: { plat: "foufou sauce graine" } },
    ],
  },

  // ── Famille et célébrations ─────────────────────────────────────────────
  "mariage": {
    specs: {
      promesse: "Le souvenir de mariage qu'on encadre.",
      lumiere: "Heure dorée, contre-jour, halo sur les tissus.",
      cadrage: "Plan moyen, tenues détaillées, cour ou salle décorée.",
      distance: "Moyenne : les mariés entiers, le décor présent.",
      jugement: "Les tissus brillent-ils juste ? Décor de cérémonie crédible, émotion lisible sans visages ratés.",
    },
    cas: [
      { phrase: "Les mariés sortent sous les youyous dans la cour décorée", textes: { tenues: "bazin blanc brodé or" } },
      { phrase: "Le couple assis sur les trônes de la cérémonie", textes: { tenues: "wax assorti bleu et or" }, lieu: "Cotonou" },
      { phrase: "La première danse sous les guirlandes", textes: { tenues: "kente et dentelle" } },
    ],
  },
  "bapteme": {
    specs: {
      promesse: "La douceur d'une naissance — tissus clairs, mains, tendresse.",
      lumiere: "Fenêtre, intérieur calme.",
      cadrage: "Plan rapproché sur les mains et les tissus.",
      distance: "Proche et intime.",
      jugement: "La tendresse passe-t-elle ? Blancs propres, peau de bébé crédible, zéro kitsch.",
    },
    cas: [
      { phrase: "La grand-mère porte le bébé, la famille se penche autour", textes: { tenues: "blanc et dentelle" } },
      { phrase: "Les mains de la mère nouent le pagne autour du nouveau-né" },
      { phrase: "Le bébé endormi sur un pagne wax clair, mains protectrices" },
    ],
  },
  "portrait-famille": {
    specs: {
      promesse: "Trois générations réunies, fières, dans leur cour.",
      lumiere: "Fin d'après-midi, égale sur chaque visage.",
      cadrage: "Plan large du groupe, cour familiale.",
      distance: "Loin : tout le monde entier, personne coupé.",
      jugement: "Chacun est-il net et digne ? Groupe organisé sans raideur, cour vivante.",
    },
    cas: [
      { phrase: "Trois générations assises devant la maison familiale", textes: { tenues: "wax assorti pour tous" } },
      { phrase: "La famille debout autour des grands-parents assis", lieu: "Ouagadougou" },
      { phrase: "Le repas de famille dans la cour, tous tournés vers l'objectif", textes: { tenues: "tenues du dimanche" } },
    ],
  },
  "anniversaire": {
    specs: {
      promesse: "La fête en couleurs — ballons, gâteau, joie.",
      lumiere: "Guirlandes, chaude, intérieure.",
      cadrage: "Plan moyen autour de la table.",
      distance: "Moyenne : l'enfant et la fête ensemble.",
      jugement: "La joie est-elle communicative ? Couleurs vives sans criard, gâteau crédible.",
    },
    cas: [
      { phrase: "L'enfant souffle ses bougies, les cousins autour de la table", textes: { tenues: "robe de fête rose" } },
      { phrase: "Les enfants dansent sous les ballons dans le salon" },
      { phrase: "La grand-mère apporte le gâteau sous les applaudissements" },
    ],
  },
  "hommage": {
    specs: {
      promesse: "Un hommage digne, le bas réservé aux dates.",
      lumiere: "Latérale douce, fond très sombre.",
      cadrage: "Buste centré, BAS DE L'IMAGE VIDE.",
      distance: "Proche, solennelle.",
      jugement: "La dignité d'abord : sobriété totale, bande basse réellement vide, aucun pathos.",
    },
    cas: [
      { personnages: [{ role: "un homme d'âge mûr" }], textes: { tenue: "boubou blanc" }, annee: 1990 },
      { personnages: [{ role: "une matriarche" }], textes: { tenue: "foulard et châle sombre" } },
      { personnages: [{ role: "un ancien combattant" }], textes: { tenue: "uniforme et médailles" }, annee: 1955 },
    ],
  },

  // ── Foi et sagesse ──────────────────────────────────────────────────────
  "affiche-religieuse": {
    specs: {
      promesse: "Un ciel travaillé qui porte le verset — le haut reste vide.",
      lumiere: "Descendante à travers les nuages, rayons visibles.",
      cadrage: "Très large, horizon bas, CIEL VIDE en haut.",
      distance: "Très loin : le paysage est un décor de promesse.",
      jugement: "Le ciel inspire-t-il sans kitsch ? Zone haute réellement libre, rayons crédibles.",
    },
    cas: [
      { phrase: "Une colombe au-dessus des collines au lever du jour" },
      { phrase: "Un chemin de latérite qui monte vers la lumière", lieu: "plateau dogon" },
      { phrase: "Des mains ouvertes vers le ciel au-dessus du fleuve" },
    ],
  },
  "fond-citation": {
    specs: {
      promesse: "Un fond qui laisse TOUTE la place à la citation.",
      lumiere: "Diffuse, plus riche aux bords.",
      cadrage: "Motifs en bordure, CENTRE VIDE ET SOMBRE.",
      distance: "Abstraite — pas de sujet.",
      jugement: "Un texte blanc posé au centre serait-il parfaitement lisible ? Bords décoratifs sans envahir.",
    },
    cas: [
      { phrase: "Un dégradé profond bleu nuit, motif discret en bordure" },
      { phrase: "Une texture terre et ocre, coins ornés de motifs bogolan" },
      { phrase: "Un fond vert forêt profond, liseré doré aux bords" },
    ],
  },
  "scene-priere": {
    specs: {
      promesse: "La prière en silhouettes, à l'heure où la lumière raconte.",
      lumiere: "Contre-jour total d'aube ou de crépuscule.",
      cadrage: "Plan large, mosquée en banco ou église à l'horizon.",
      distance: "Loin : les fidèles sont des formes, jamais des visages.",
      jugement: "Le respect passe par la distance : silhouettes pures, architecture juste, ciel habité.",
    },
    cas: [
      { phrase: "Les fidèles quittent la mosquée à la tombée du jour", annee: 1980 },
      { phrase: "Une file de femmes en prière face au fleuve à l'aube" },
      { phrase: "La procession entre dans l'église au crépuscule", lieu: "Lomé" },
    ],
  },

  // ── Récit et histoire ───────────────────────────────────────────────────
  "nuit-archive": {
    specs: {
      promesse: "Le clair-obscur nocturne signature de la page : une lampe, un mystère.",
      lumiere: "UNE seule source dans la scène, collée au sujet ; ambre sur ombres sarcelle.",
      cadrage: "35 mm poitrine, plan large, sujet au tiers, de trois-quarts ou de dos, sol mouillé.",
      distance: "Loin : le sujet appartient à la nuit, une ou deux figures max.",
      jugement: "Passerait-elle sur la page ? Noirs bouchés, halo près du visage, jamais plus de deux figures nettes.",
    },
    cas: [
      { phrase: "Un homme seul marche vers l'agence de la banque, sous la pluie", annee: 2003, lieu: "Bouaké" },
      { phrase: "Un homme sort de sa voiture devant sa maison, des soldats l'attendent dans la cour", annee: 1973, lieu: "Conakry" },
      { phrase: "Une silhouette attend sous le lampadaire du marché désert", annee: 1987 },
    ],
  },
  "heure-doree": {
    specs: {
      promesse: "Le contre-jour doré des départs et des arrivées.",
      lumiere: "Soleil bas, silhouette cerclée d'or, poussière en suspension.",
      cadrage: "35 mm poitrine, plan large, sujet au tiers, trois-quarts ou dos.",
      distance: "Loin : la silhouette dans l'immensité.",
      jugement: "Passerait-elle sur la page ? Contre-jour franc, poussière dorée, ciel ocre.",
    },
    cas: [
      { phrase: "Un guerrier touareg se dresse au sommet d'un massif, une caravane passe en contrebas", annee: 1916, lieu: "Aïr" },
      { phrase: "Un cavalier rentre au village, le soleil dans le dos", annee: 1890 },
      { phrase: "Une femme porte l'eau sur la piste, ombre immense devant elle" },
    ],
  },
  "affiche-resistance": {
    specs: {
      promesse: "Le triptyque héroïque, bandeaux libres pour les dates.",
      lumiere: "Ciel orange brûlé derrière les figures.",
      cadrage: "Trois figures alignées, BANDEAUX HAUT ET BAS VIDES.",
      distance: "Moyenne : des silhouettes-statues, pas des portraits.",
      jugement: "Le poster donne-t-il des frissons ? Figures découpées nettes, bandeaux réellement vides.",
    },
    cas: [
      { personnages: [{ role: "une résistante" }, { role: "un soldat" }, { role: "un étudiant" }], annee: 1960 },
      { personnages: [{ role: "trois cultivatrices" }], annee: 1975, lieu: "Sahel" },
      { personnages: [{ role: "un syndicaliste" }, { role: "une institutrice" }, { role: "un cheminot" }], annee: 1947 },
    ],
  },
  "document-epoque": {
    specs: {
      promesse: "Un tirage d'époque retrouvé — grain, bords abîmés, vérité.",
      lumiere: "Plate et dure, celle d'un flash de presse.",
      cadrage: "Documentaire, léger flou de bougé.",
      distance: "Moyenne, sur le vif.",
      jugement: "Le doute doit exister : « c'est une vraie archive ? ». Grain argentique, époque exacte.",
    },
    cas: [
      { phrase: "Deux hommes signent un accord dans une salle bondée", annee: 1960, lieu: "Léopoldville" },
      { phrase: "Le marché un jour de pluie, parapluies noirs", annee: 1948 },
      { phrase: "Les dockers déchargent un cargo au port", annee: 1935, lieu: "Dakar" },
    ],
  },
  "plein-jour-poussiere": {
    specs: {
      promesse: "L'harmattan à midi : blancs voilés, ombres courtes.",
      lumiere: "Zénithale dure, brume de poussière.",
      cadrage: "Plan large, horizon haut, savane ou piste.",
      distance: "Loin : les gens appartiennent au paysage écrasé de chaleur.",
      jugement: "Sent-on la chaleur ? Blancs voilés, distance blanchie, ombres au pied.",
    },
    cas: [
      { phrase: "Des camions militaires traversent un grand marché sous le soleil de midi", annee: 1943, lieu: "Dakar" },
      { phrase: "Une colonne de réfugiés marche sur la piste", annee: 1984, lieu: "Sahel" },
      { phrase: "Les enfants jouent au foot dans la poussière du terrain vague" },
    ],
  },
  "carte-ancienne": {
    specs: {
      promesse: "Une carte d'époque à l'encre, prête pour un récit.",
      lumiere: "Plate — c'est un document scanné.",
      cadrage: "Vue de dessus, tracés, rose des vents.",
      distance: "Zéro sujet : le papier est le héros.",
      jugement: "Papier vieilli crédible, tracés à la main, toponymes plausibles sans charabia envahissant.",
    },
    cas: [
      { phrase: "Les routes des caravanes entre Agadez et Tombouctou", annee: 1850 },
      { phrase: "Le golfe et ses comptoirs de la côte", annee: 1720 },
      { phrase: "Le fleuve Niger et ses villes, du delta à la boucle", annee: 1900 },
    ],
  },

  // ── Réseaux et contenu ──────────────────────────────────────────────────
  "miniature-video": {
    specs: {
      promesse: "La miniature qui fait cliquer — sujet à gauche, titre à droite.",
      lumiere: "Frontale forte, saturation poussée.",
      cadrage: "Sujet à gauche, MOITIÉ DROITE VIDE.",
      distance: "Proche : l'expression est le sujet.",
      jugement: "Cliquerais-tu ? Expression marquée lisible en petit, moitié droite réellement libre.",
    },
    cas: [
      { phrase: "Il découvre la vérité, les mains sur la tête", personnages: [{ role: "un homme stupéfait" }] },
      { phrase: "Elle montre du doigt quelque chose de choquant hors champ", personnages: [{ role: "une femme choquée" }] },
      { phrase: "Un vieil homme sourit, mystérieux, doigt sur les lèvres" },
    ],
  },
  "motivation": {
    specs: {
      promesse: "Le fond de citation motivante : silhouette face à l'horizon.",
      lumiere: "Latérale dure, tons froids cinéma.",
      cadrage: "Figure de dos, HAUT DE L'IMAGE VIDE.",
      distance: "Loin : la personne est petite face au monde.",
      jugement: "Une phrase en haut serait-elle lisible ? Dos crédible, horizon qui inspire.",
    },
    cas: [
      { phrase: "Un homme de dos regarde la ville depuis la colline à l'aube", personnages: [{ role: "un homme de dos" }] },
      { phrase: "Une coureuse s'étire face au stade vide au petit matin" },
      { phrase: "Un pêcheur debout sur sa pirogue face au large" },
    ],
  },
  "ville-nuit": {
    specs: {
      promesse: "La ville africaine la nuit — néons, phares, vie.",
      lumiere: "Enseignes, vitrines, longue pose.",
      cadrage: "Plan large de rue, circulation, reflets.",
      distance: "Loin : la rue entière est le sujet.",
      jugement: "La ville vit-elle ? Traînées de phares, enseignes plausibles, asphalte mouillé qui reflète.",
    },
    cas: [
      { phrase: "Le carrefour et ses enseignes sous la pluie", lieu: "Lagos" },
      { phrase: "Les gargotes éclairées le long de l'avenue, motos qui passent" },
      { phrase: "Le marché de nuit sous les ampoules suspendues", lieu: "Kinshasa" },
    ],
  },
  "nature-afrique": {
    specs: {
      promesse: "Le paysage panoramique qui coupe le souffle.",
      lumiere: "Heure dorée ou orage qui monte.",
      cadrage: "Très grand angle, profondeur en plans successifs.",
      distance: "Infinie : l'échelle du continent.",
      jugement: "Mettrais-tu ce fond d'écran ? Profondeur lisible, lumière dramatique sans HDR criard.",
    },
    cas: [
      { phrase: "Le fleuve au couchant, les pirogues rentrent" },
      { phrase: "L'orage monte sur la savane, un baobab isolé en premier plan" },
      { phrase: "Les dunes rousses à l'aube, une caravane minuscule au loin" },
    ],
  },
};
