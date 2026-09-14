# AyaRégie, outil de régie événementielle

Outil libre (licence MIT) de l'association Aya Atma pour organiser un événement: bénévoles et
créneaux, montage et démontage, orgas, repas, artistes et billetterie. Son premier terrain est le
Loto Tekno, le 13 mars 2027, de 12h à 6h du matin: environ 600 heures-personnes à pourvoir sur
une quinzaine de pôles et sous-pôles.

L'événement se joue en trois moments, et l'outil aussi: le **montage** les jours d'avant,
l'**exploit** (les dix-huit heures d'ouverture au public, sur quoi porte tout ce qui parle de
règles, de solveur et de créneaux), et le **démontage** les jours d'après. Deux sortes de
personnes y travaillent: les **bénévoles**, qui remplissent le formulaire et que le solveur
répartit sous contraintes, et les **orgas**, soumis à aucune de ces règles. Un **responsable**
est un orga à qui on a confié un pôle.

Le cahier des charges complet, les contraintes et l'historique des décisions vivent dans
`.claude/memory/project_brief.md`.

## État

Les repas et les tickets boisson sont construits (12 septembre 2026): un onglet **Catering**, une
carte de réglages, et le régime et les allergies lus du formulaire pour tout le monde. La
migration `15` qui porte tout cela est **écrite et pas encore appliquée**.

Le montage et le démontage sont construits (10 septembre 2026): deux grilles de plus, avec leurs
propres pôles, leurs nuits non travaillées, leurs demi-journées et leurs événements ponctuels.
Rien n'y est calculé, le régisseur y place à la main. La migration `13` qui porte tout cela est
appliquée et déployée.

Le moteur de planning est terminé et vérifié. L'interface régisseur est construite et branchée
sur Supabase: la grille, les propositions, le tableau de bord, la vue recrutement, les réglages,
l'import, l'impression, l'historique des versions et le journal fonctionnent sur des jeux de
données à taille réelle. La vue bénévole existe: un code d'accès, aucun compte, ses propres
créneaux et le numéro de son ou sa responsable. Restent le déploiement sur `planning.ayaatma.fr`
et l'accès responsable de pôle.

Le formulaire Google réel a été lu le 8 septembre 2026. L'import est calé sur ses 40 colonnes, et
**le générateur les écrit toutes**, décoys compris, donc une répétition sur données synthétiques
rencontre exactement le fichier que le régisseur déposera. Les intitulés se règlent en un seul
endroit, `tools/src/csv.ts`.

## Contenu

```
db/schema.sql        Schéma Postgres / Supabase, avec le verrouillage RLS et les deux
                     fonctions d'accès bénévole
tools/               Le moteur, les jeux de test synthétiques et les harnais en ligne
                     de commande
app/                 L'interface régisseur, React + Vite. Elle importe le moteur
                     directement depuis tools/src, sans copie
.claude/memory/      Mémoire de projet, lue au début de chaque session
```

## Lancer l'interface

```bash
cd tools && npm install && npm run fixture -- --all   # écrit app/public/fixtures/
cd ../app && npm install && npm run dev
```

Choisissez un scénario et la grille s'ouvre dessus. Les modifications sont enregistrées
automatiquement dans le navigateur.

Le moteur tourne entièrement côté client. La validation coûte 4 ms, donc les codes couleur sont
recalculés à chaque changement, sans délai ni anti-rebond. Le solveur, lui, tourne dans un Web
Worker: la grille reste consultable pendant les deux secondes de calcul.

## La grille

Un pôle par ligne, les dix-huit heures de l'événement en abscisse, la programmation sur la
règle du haut. Dans chaque créneau, **une case par bénévole nécessaire**: un créneau qui demande
cinq personnes dessine cinq cases.

Aucune règle de planning n'est écrite dans l'interface. Au début d'un glisser, les cibles
légales sont demandées au moteur, sur le plan tel qu'il serait une fois la case retirée de son
emplacement actuel. Les cibles illégales sont grisées mais acceptent quand même le dépôt, et la
raison en français vient de `blockersFor`. L'outil montre au régisseur ce qu'il vient de faire,
il ne refuse jamais l'édition.

Le rouge désigne une case, jamais une personne: il dit que ce bénévole, sur ce créneau, enfreint
une règle. Un souci sur son créneau du soir ne colore pas sa case de l'après-midi. Un créneau
incomplet n'est pas rouge non plus, les cases pointillées le disent déjà. La bande orange sur le
bord gauche d'une case est une journée de 6 h ou de 8 h: une information, pas une alerte.

Un problème qui concerne le créneau et non quelqu'un en particulier, comme un créneau composé
uniquement de débutants, marque le bord du créneau entier. Ce ne sont pas cinq bénévoles fautifs,
c'est un créneau à qui il manque une personne expérimentée.

**Le nom court d'une case désigne toujours une seule personne.** Une case fait onze caractères,
donc elle porte le prénom et le début du nom. Ce début est coupé au plus court qui distingue
cette personne de toutes les autres que l'outil connaît, bénévoles et responsables confondus:
une lettre quand rien ne se ressemble, trois quand deux Marie ont un nom en D. Seules les
personnes concernées s'allongent. Si le formulaire porte un surnom, c'est lui qui remplace le
prénom, et seulement là: les listes d'accueil, les exports et tout ce qui sert à vérifier une
identité gardent le nom d'inscription. Le calcul est dans `tools/src/display.ts`, écrit une seule
fois: la base ne le refait pas, elle lit `volunteer.display_name`, que le navigateur réécrit à
chaque enregistrement.

## Montage et démontage

Les deux phases se règlent dans Réglages et se dessinent dans l'onglet Grille, par le sélecteur
**Montage / Exploit / Démontage** en haut à gauche. Tant qu'une phase n'est pas activée, elle
n'apparaît nulle part.

Ce qu'une phase porte, et qui n'a rien à voir avec l'exploit:

- **Ses propres dates**, indépendantes de l'événement. Les heures d'une phase se comptent à
  partir de son propre début, jamais de celui de l'exploit.
- **Ses heures non travaillées**, un créneau d'horloge répété chaque jour (00h à 08h par défaut).
  La grille ne les dessine pas: une nuit est une séparation entre deux colonnes, pas du vide.
- **Ses pôles**, dont « Général », qui ne se supprime pas. Le démontage peut reprendre ceux du
  montage en un bouton.
- **Ses événements**: « Déchargement camion », une tranche horaire précise, un nombre de
  personnes, prises dans n'importe quel pôle. C'est la seule chose d'une phase qui puisse
  manquer de monde, et elle le dit sur la grille et au tableau de bord.
- **Une fenêtre ouverte aux bénévoles**. Un bénévole qui a répondu « oui » sans donner d'horaire
  est placé sur toute cette fenêtre.

La grille a la même forme que celle de l'exploit: les pôles à gauche, les heures en haut. Ce qui
change est ce qu'une barre veut dire. Sur l'exploit, un créneau est une case qui tient N
bénévoles. Sur une phase il n'y a pas de créneau: un pôle a des gens dedans, chacun sur ses
propres heures, et « présent toute la journée » est une barre sur toute la journée. **Une barre
est donc une personne**, et trois personnes en même temps sur Technique Son sont trois lignes.
Les événements sont l'exception et sont exactement un créneau: un titre, une plage précise, un
nombre de personnes à trouver. Ils ont leur propre ligne, en haut.

Les nuits ne sont pas dessinées. Les plages travaillées de chaque jour sont posées bout à bout
avec un écart entre elles, donc une heure fait la même largeur partout et la nuit est une
séparation plutôt que les deux tiers d'un écran vide (`app/src/components/phaseAxis.ts`).

**La réponse d'un orga est une affectation. Celle d'un bénévole ne l'est pas.** Un orga qui a
rempli « je suis là à partir de mercredi 8h » est placé à partir de mercredi 8h, une case par jour
travaillé, dans le pôle qu'il a nommé ou dans Général. Le bouton **« Placer N présences
déclarées »** de la barre d'outils écrit ces cases; il n'écrit que ce qui manque et ne touche
jamais une case existante.

Un bénévole, lui, reste dans **« Disponibles »** jusqu'à ce que quelqu'un l'y glisse (12 septembre
2026). Les deux réponses ne veulent pas dire la même chose: un orga écrit quand il **est** là, un
bénévole répond s'il **serait d'accord** pour venir, et il y a cent vingt bénévoles pour un montage
qui a besoin de quinze personnes. Dessiner la seconde enterrait la poignée de gens que le
régisseur voulait vraiment sur la grille. Corriger la réponse d'un bénévole ne touche pas non plus
à ses cases: celles qui la contredisent passent en rouge, ce qui est le travail de l'outil ici.

Il n'y a pas de second type de case, plus pâle: la grille dessine le plan, et rien d'autre.

Ce à quoi la déclaration sert ensuite, c'est **le rouge**. Une case posée un jour où la personne
a dit ne pas être là, ou sur un autre pôle que celui de son formulaire, est dessinée en rouge avec
la raison dans son infobulle et dans la liste sous la grille. Rien n'est jamais refusé ni
déplacé: une phase n'a pas de règles, elle a des réponses, et une case qui en contredit une
mérite d'être dite.

Changer la **date** d'arrivée de quelqu'un réécrit ses cases, puisque les anciennes portaient sur
des jours où il n'est plus là. Changer son **pôle** ne les touche pas: elles ont pu être posées à
la main, pôle par pôle, et suivre le formulaire les effacerait.

**Au clavier**, sur la grille de l'exploit comme sur celles du montage et du démontage: les
**flèches** circulent de case en case, **Suppr** retire la personne de la case où est le curseur,
**Échap** désélectionne. Sur une phase, monter ou descendre va à la case **la plus proche dans le
temps** sur la ligne voisine, parce qu'une phase n'est pas un damier: chaque case a ses propres
heures. La case pointée est la case sélectionnée, donc le volet de droite suit les flèches, et la
barre d'outils dit ce que la dernière touche a fait.

**Tirer un bord d'une case l'allonge ou la raccourcit**, au quart d'heure, sans sortir du jour
où elle est. Glisser une case d'un pôle à l'autre garde ses heures. Cliquer une case ouvre son
panneau: qui, quand, ce qui cloche, son pôle, et de quoi la retirer.

Le panneau de droite porte **deux onglets, « Orgas dispo » et « Bénévoles dispo »**, et un filtre
par jour, comme la réserve de l'exploit: les personnes qui ont déclaré être là ce jour-là et dont
il reste des heures à placer. Glisser un nom sur un pôle le place **sur les heures qu'il a
déclarées pour ce jour-là**, pas sur la journée entière: un « vendredi après-midi » tombe le
vendredi après-midi.

Une personne tient **une seule ligne** par pôle, quelles que soient ses plages: deux présences
qui se suivent se lisent comme une personne et non comme deux. Même règle sur l'exploit, où
quelqu'un qui enchaîne deux créneaux du même pôle garde sa ligne d'un créneau à l'autre
(`app/src/components/laneRows.ts`). Une ligne gardée ne fait jamais grandir un créneau: une case
« à pourvoir » doit rester une place à pourvoir.

Un **losange ◆** devant un nom désigne un orga, sur les trois grilles. Les étoiles disent déjà le
niveau d'un bénévole, donc la marque des orgas ne pouvait pas en être une.

Les événements partagent **une seule ligne**, qui n'existe que s'il y en a au moins un. Chacun est
un bloc avec son nom sur le bandeau, son compte (`2/6`) et une place par personne demandée,
« à pourvoir » comprises: le créneau de l'exploit, avec un titre en plus.

`npx tsx src/screens/phasePreview.tsx` (dans `app/`) écrit
`phase-preview.html`, la grille avec la vraie feuille de style, à ouvrir dans un navigateur sans
base ni connexion.

Un orga peut aussi être posé **sur un créneau de l'exploit**, à la main, en cliquant une place
« à pourvoir ». Il y prend une place et n'est soumis à aucune règle d'heures; le solveur ne le
choisit ni ne le déplace jamais.

## Repas et tickets boisson

Le traiteur pose deux questions et deux seulement: **combien de personnes mangent à chaque
service**, et **ce qu'elles ne peuvent pas manger**. Tout l'onglet **Catering** vise ces deux
réponses et s'arrête là.

Les règles se posent dans Réglages, carte « Repas et tickets boisson », et rien n'est dessiné tant
que la case du haut n'est pas cochée. Ce qui s'y règle:

- **Les services d'une journée**, en heures d'horloge: midi de 12h à 14h, soir de 19h à 21h. Ce
  sont les mêmes tous les jours du montage, de l'exploit et du démontage, parce qu'un repas est à
  midi, pas « à l'heure 37 du montage ». C'est le seul endroit de cet outil où une heure n'est pas
  un décalage depuis un début.
- **Les paliers de repas de l'exploit**, sous la forme « à partir de 4 h travaillées, 1 repas ».
  Une liste et non une formule: le régisseur a dit « 4h donne droit à 1 repas, 6h ou 8h donnent
  droit à 2 repas », ce qui est une fonction en escalier, et l'événement suivant aura d'autres
  marches.
- **Un ticket boisson toutes les N heures travaillées**, et de quoi compter ou non le montage et
  le démontage dedans.
- **Un plancher pour les orgas**: 2 repas et 2 tickets, même sans créneau pendant l'exploit. Un
  plancher, jamais un plafond.

**Deux règles différentes, parce que ce sont deux choses différentes.** Sur l'exploit un repas se
**gagne** aux heures travaillées, et le quota se dépense sur les services les plus proches des
heures de la personne. Sur le montage et le démontage un repas se **mange**: on lit les cases de
la personne sur la grille, et **à défaut de case, ce qu'elle a déclaré au formulaire**. Dans cet
ordre, et l'ordre est la décision: une case gagne toujours, parce qu'une case est une décision
(quelqu'un dont le jeudi a été raccourci à 09h-11h part avant le repas), et la déclaration ne sert
que pour qui n'a aucune case, parce que cette personne se présente quand même et qu'une assiette
manquante coûte plus cher qu'une assiette de trop. Les deux se fondent dans le même jeu de cases
cochées.

Un service partagé entre deux moments est **un seul service**. Le dernier jour du montage est le
jour de l'événement, et midi ce jour-là est une seule file avec une seule casserole: le compter
une fois par moment aurait dit au traiteur d'en cuire deux fois.

**Les cases cochées font foi, le calcul n'en est que le défaut.** Le régisseur coche et décoche
personne par personne, et **seuls ses désaccords sont enregistrés** (`MealChoice`). Une case qui
retombe d'accord avec l'outil cesse d'être stockée. C'est ce qui permet à un créneau de bouger, à
un palier de changer ou à un jour de montage de s'ouvrir sans figer le comptage d'hier: une case
décidée à la main est entourée de bleu et survit à tout, les autres suivent le planning.

Le bouton **« Exporter pour le traiteur »** écrit un CSV: une ligne par personne, une colonne par
service, les tickets, le régime et les allergies, avec une ligne de totaux à la fin.

Le régime et les allergies viennent du formulaire, colonnes 11 et 12, que l'import laissait tomber
jusqu'au 12 septembre 2026. Ils se corrigent sur la fiche, et un ré-import ne défait pas une
correction.

## La fiche d’un orga

Tout ce qu’un orga a répondu se corrige, et depuis deux endroits: la carte « Orgas » de Réglages,
bouton **Modifier**, et la grille, où le champ de recherche propose les orgas à côté des
bénévoles (« Camille Dubois (orga) »). C’est la même fiche, pas deux copies.

Elle porte le nom, l’adresse, le téléphone, le régime, les allergies, les remarques, et pour
chaque phase **le jour d’arrivée ou de départ et le pôle**. Le formulaire n’est qu’un point de
départ: les plans des gens changent, et un ré-import ne réécrit jamais ce que le régisseur a
décidé, puisqu’il ne remplit un champ que si l’export porte une réponse pour lui.

Le code d’accès, lui, ne se modifie pas là: c’est une clé, pas une réponse. Il se génère et se
révoque depuis la liste, une personne à la fois.

## Les propositions se valident par décision, pas par ligne

Un échange entre deux personnes, ce sont deux déplacements. Accepter l'un sans l'autre laissait
un créneau en sureffectif jusqu'à ce qu'on retrouve la ligne qui répare. Le moteur découpe donc
le lot en décisions autonomes, et dit lesquelles en nécessitent d'autres. Accepter une décision
emporte ses prérequis, la refuser refuse ce qui en dépendait.

"Recalculer" fait un tour. "Jusqu'à stabilité" enchaîne les tours jusqu'à ce que trois
recherches d'affilée ne trouvent plus rien, et rend un seul lot. Comptez de dix à soixante
secondes selon l'événement, avec le numéro de tour affiché pendant le calcul. Les places
verrouillées ne bougent dans aucun tour.

Plusieurs tours sont nécessaires parce que le poids de stabilité fait refuser à chaque tour les
améliorations qui valent moins que leur coût: une fois le tour accepté, ce coût est encaissé et
le suivant peut se payer le palier d'après.

La graine du solveur est dérivée du plan quand on ne la précise pas. C'est ce qui rend la
promesse vraie: résoudre un plan donné lance toujours la même recherche, donc si le dernier tour
l'a lancée sans rien trouver, un "Recalculer" derrière ne trouve rien non plus. Un même plan
donne toujours le même résultat, et une graine explicite reste prioritaire.

## Vérifier

```bash
cd tools && npm test && npm run typecheck    # 218 tests, le moteur, les phases, l'import, le déploiement
cd app   && npm test && npm run typecheck    # 253 tests, les éditions, le journal, les écrans
```

Deux vérifications supplémentaires portent sur la base, qui n'existe sur aucune machine de
développement:

```bash
cd tools
npm run sql-check     # analyse db/schema.sql et les migrations avec la grammaire Postgres 17
npm run schema-check  # chaque champ du Plan fait-il bien l'aller-retour avec Postgres
npm run anon-check    # ce que la clé anonyme atteint réellement sur le projet en ligne
npm run db-check      # la base en ligne a-t-elle bien tout ce que db/schema.sql décrit
```

`sql-check` attrape la syntaxe, jamais les noms de colonnes ni les conversions de type: seule la
première exécution réelle les vérifie.

`schema-check` attrape la perte de données silencieuse. Un plan est enregistré **en entier**:
`write_plan_body` efface le contenu de l'événement et le réécrit depuis le document JSON, et
`load_plan` reconstruit ce document. Les deux nomment chaque champ explicitement, donc ajouter un
champ au moteur en l'oubliant dans **une** des deux fonctions ne produit aucune erreur: le
typage est content, le SQL est valide, les tests passent, l'écran affiche la valeur, et elle
disparaît à l'enregistrement suivant. Pour tout le monde.

`anon-check` est à relancer après **toute** modification des droits, parce qu'un `grant` n'est
pas vérifié tant que la clé anonyme n'a pas été pointée dessus. Il sonde les fonctions et les
tables, et n'envoie que des appels inoffensifs sur un identifiant d'événement inexistant.

`db-check` est le seul des quatre qui interroge la base plutôt qu'un fichier, et c'est pour cela
qu'il existe. Le 2026-09-08, une migration écrite, relue, recopiée dans `db/schema.sql` et
inscrite au registre à la main n'avait jamais été exécutée: les trois autres vérifications
passaient, et l'outil ne pouvait plus ni ouvrir ni enregistrer un planning. Il demande chaque
table et chaque colonne avec `limit=0`, donc aucune ligne ne circule et la clé anonyme suffit.

## Appliquer les migrations

```bash
cd tools
npm run migrate                # ce qui serait appliqué, sans rien exécuter
npm run migrate -- --apply     # applique, chaque fichier dans sa transaction
npm run migrate -- --apply --only=2026-09-08_exemple.sql   # rejoue un fichier précis
```

Il faut `SUPABASE_DB_URL` dans `.env.deploy.local`, la chaîne « Session pooler » du projet
Supabase. Sans elle, seule la liste des fichiers s'affiche.

**Recopiez cette chaîne entière, ne réécrivez pas l'hôte de mémoire.** Il a la forme
`aws-<n>-<région>.pooler.supabase.com` et ni le chiffre ni la région ne se devinent: ce projet
est sur `aws-1-eu-west-1`. Un hôte inventé répond `tenant/user ... not found`, ce qui ressemble
à un problème de mot de passe sans en être un.

`tools/supabase-ca.crt` est l'autorité de certification de Supabase, la seule à laquelle cette
connexion fait confiance. Supabase ne signe pas ses certificats Postgres avec une autorité
publique, donc sans ce fichier Node refuse par `SELF_SIGNED_CERT_IN_CHAIN`. Il ne contient aucun
secret, il fait partie du dépôt, et il expire le 2031-04-26. La vérification reste stricte, nom
d'hôte compris: `rejectUnauthorized: false` chiffrerait le mot de passe sans rien prouver sur qui
le reçoit.

**Chaque migration s'exécute dans une seule transaction, et sa ligne de registre est écrite dans
cette même transaction.** Donc soit le schéma a changé et le registre le dit, soit ni l'un ni
l'autre. Un registre rempli à la main dit ce que quelqu'un croyait avoir fait; celui-là ne le
peut plus. La commande finit toujours par la vérification de `db-check`, y compris quand elle
n'a rien eu à appliquer.

**L'ordre vient des fichiers, pas de leur nom**: chacun commence par `-- migration-sequence: N`.
Deux migrations écrites le même jour se trient par leur sujet, ce qui ne dit rien de leur ordre,
et le piège s'est refermé deux fois en une après-midi.

## Ajouter un champ au plan

Dans cet ordre, et le point 2 est celui qu'on oublie:

1. Le champ dans `tools/src/model.ts` ou `plan.ts`.
2. **`PLAN_FORMAT` dans `tools/src/plan.ts`: +1, dans le même commit.** C'est ce numéro qui
   empêche un onglet resté ouvert sur l'ancienne version d'écraser le nouveau champ pour tout le
   monde. Un numéro incrémenté trop tard ne protège rien.
3. La valeur par défaut dans `app/src/persistence/normalise.ts`, sinon un plan enregistré avant
   le champ fait planter l'écran qui le lit.
4. `db/schema.sql`: la colonne, `load_plan` et `write_plan_body`.
5. Une migration qui fait la même chose sur la base existante, ouverte par
   `-- migration-sequence: N`, **plus**
   `update app_setting set number = <le nouveau PLAN_FORMAT> where name = 'min_plan_format'`.
   Sa ligne de `schema_migration` est écrite par `npm run migrate`, dans la transaction du
   fichier: ne l'écrivez pas à la main, c'est comme ça qu'un registre se met à mentir.
6. Si l'information vient du formulaire: `tools/src/import.ts`, et `reconcile.ts` refusera de
   compiler tant que le champ n'est pas déclaré comparable ou explicitement exclu.
7. `npm run schema-check`, `npm run sql-check`, les tests des deux paquets.
8. `npm run migrate -- --apply`, **puis** `npm run deploy`. Dans cet ordre: entre les deux, les
   onglets ouverts se voient refuser l'écriture, ce qui est exactement le but.

Un ré-import du formulaire met à jour tous les bénévoles déjà présents sans toucher à leurs
affectations, à leur code d'accès ni à la réserve. C'est la façon prévue de remplir un nouveau
champ pour des gens déjà dans la base.

## Déployer

```bash
cd tools
npm run deploy -- --probe      # dit ce que l'hôte accepte, n'envoie rien
npm run deploy -- --dry-run    # dit ce qu'il enverrait et supprimerait, ne touche à rien
npm run deploy                 # construit, envoie, vérifie
```

**Le transport est négocié, et le FTP en clair n'est jamais automatique.** Le script tente SFTP,
puis FTPS explicite, puis FTPS implicite, et **s'arrête** plutôt que d'envoyer le mot de passe en
clair. Ce repli existe, il tient en une ligne (`DEPLOY_PROTOCOL=ftp`), et il doit être écrit à la
main: ce compte peut réécrire le site de l'association.

Ce que `--probe` a mesuré sur `ftp.cluster0XX.hosting.ovh.net` le 8 septembre 2026:

| Transport | Résultat |
|---|---|
| SFTP | **fonctionne**, foyer `/home/<compte>` |
| FTPS explicite | `500 This security scheme is not implemented` |
| FTPS implicite | port 990 filtré |
| FTP en clair | fonctionne, et ne servira pas |

**Les deux protocoles n'épellent pas les chemins pareil.** Un compte FTP OVH est enfermé à la
racine de son espace, donc le dossier du sous-domaine s'y appelle `/planning`; une session SFTP
part du foyer réel et le même dossier s'appelle `/home/<compte>/planning`. Le script résout l'un
depuis l'autre, à partir du `DEPLOY_FTP_DIR` écrit à la façon FTP, qui est aussi la façon dont
le champ « dossier racine » du multisite OVH est écrit.

`--dir=/ailleurs` essaie un autre dossier sans toucher au fichier qui contient le mot de passe.
Sous Git Bash, préfixez la commande de `MSYS_NO_PATHCONV=1`, sinon le shell traduit le chemin
en chemin Windows avant que le script ne le voie.

L'hébergement OVH est un dossier derrière du FTP: pas d'étape de build sur le serveur, pas de
pipeline. Le script construit localement et recopie `app/dist` dans le dossier du sous-domaine.
Les identifiants vivent dans `.env.deploy.local` à la racine, ignoré par git; le modèle est
`tools/.env.deploy.example`. **Leurs noms ne commencent pas par `VITE_`**, sinon Vite les
intégrerait dans le bundle envoyé au navigateur.

Quatre refus, un par façon dont un envoi manuel se passe mal:

1. **Un bundle construit sans `app/.env.local` n'est pas déployé.** Vite intègre la configuration
   au build, donc un tel bundle ouvre sur les jeux de test: l'outil aurait l'air installé et ne
   montrerait rien. La vérification porte sur le fichier construit, pas sur l'environnement.
2. **Les jeux de test ne partent pas.** Ils vivaient dans `public/fixtures`, que Vite recopie tel
   quel: 884 Ko de bénévoles inventés partaient à chaque envoi, et leur présence rallumait
   l'offre de les copier dans la vraie base. `vite.config.ts` les retire, le script le vérifie.
3. **Il ne supprime jamais un fichier qu'il n'a pas mis là.** C'est par là qu'un script de
   déploiement mange un site: un `DEPLOY_FTP_DIR` erroné et il vide la page d'accueil de
   l'association. Seuls les fichiers de la forme que ce build produit sont supprimés, le reste
   est signalé et laissé en place. Lancez le `--dry-run` en premier: si la liste ressemble au
   site de l'association, le dossier est le mauvais.
4. **Un dossier qui n'existe pas est un arrêt, pas un `mkdir`.** Appris en le faisant: un envoi
   avec un `DEPLOY_FTP_DIR` périmé a créé le dossier, envoyé les quatre fichiers dedans et
   annoncé une réussite, sur un site inchangé parce que personne ne sert ce dossier. Le script
   s'arrête maintenant avant d'envoyer, et affiche ce qui existe à côté. `--create-dir` est
   pour le vrai premier déploiement.
5. **`index.html` part en dernier.** Les noms d'assets portent une empreinte de leur contenu,
   donc l'ancienne page et les nouveaux fichiers coexistent sans conséquence; le site change au
   moment où `index.html` arrive.

Une fois l'envoi fini, si `DEPLOY_URL` est renseigné, le script demande la page et vérifie
qu'elle référence bien les fichiers qui viennent de partir. « Envoyé sans erreur » et « servi »
sont deux choses différentes: un cache, un mauvais dossier ou un sous-domaine pointant ailleurs
répondent tous les trois 200.

## Envoyer les codes d'accès

Le code d'accès d'un bénévole est généré par l'outil et n'est jamais saisi dans le formulaire,
donc rien ne lui parvient tant qu'on ne l'envoie pas. L'onglet **Impression** porte le bouton
« Exporter N contacts »: un CSV pour Brevo, une ligne par contact, avec les en-têtes en noms
d'attributs (`EMAIL,PRENOM,NOM,CODE_ACCES,CRENEAUX`) plutôt qu'en intitulés français, parce
qu'un import de contacts associe l'en-tête à l'attribut de la liste.

`CRENEAUX` est là pour une raison: personne ne doit recevoir « voici ton planning » alors qu'il
n'a pas de créneau. Le nombre dans le fichier permet de couper l'envoi en deux sans revenir dans
l'outil.

Deux cas sont signalés sous le bouton, parce qu'ils sont muets partout ailleurs: un bénévole sans
adresse mail n'est pas dans le fichier (son code reste sur les feuilles imprimées), et deux
personnes derrière une même adresse ne feront qu'un contact, donc un seul des deux codes
survivra à l'import.

## Des orgas et des bénévoles de montage, pour tester

```bash
cd tools
npm run orgas                  # out/orgas.csv, vingt orgas avec leurs dates d’arrivée
npm run orgas -- --count=40 --seed=7
npm run generate               # out/<scénario>/benevoles.csv, colonne montage comprise
```

**Les deux fichiers s’importent, ils ne s’écrivent pas dans la base.** C’est le but: le chemin
testé est celui des vraies réponses, liaison des colonnes comprise, et c’est là que ça casse.

- `out/orgas.csv` s’importe depuis Réglages, carte « Orgas ». Réimporter le même fichier met à
  jour les mêmes personnes plutôt que d’en créer d’autres: l’identité est l’adresse mail, et les
  codes d’accès déjà envoyés sont conservés.
- `out/balanced/benevoles.csv` se réimporte depuis l’onglet Import. Un tiers des bénévoles y
  répondent quelque chose au montage ou au démontage, l’écran de relecture montre ce qui change,
  et une fiche corrigée à la main n’est jamais réécrite.

Les arrivées des orgas sont des dates. Elles ne deviennent des heures que si la phase couvre le
jour en question: la commande imprime les dates à régler. Sinon la réponse reste dans les
remarques de la personne et la date se choisit sur sa fiche, en un clic.

**Sur un planning déjà rempli, `benevoles.csv` ne sert à rien**: ses cent vingt personnes ne sont
pas les vôtres, et l'import proposerait d'en créer cent vingt de plus. Pour tester sur les gens
qui sont déjà dedans:

```bash
# onglet Import, bouton « Télécharger le plan », puis
cd tools && npm run form-csv -- --plan=../planning-2026-09-10.json
```

Cela réécrit l'export du formulaire **pour vos bénévoles à vous**, chaque réponse telle qu'elle
est aujourd'hui, en ne changeant que la question montage / démontage. Réimporté, il ne crée
personne: sur `balanced`, 0 ajout, 0 retrait, 64 fiches modifiées, et les seuls champs qui
bougent sont Montage et Démontage.

L'écran d'import montre maintenant, avant d'appliquer, **les réponses que l'outil a dû
interpréter**: la phrase telle qu'elle a été écrite, ce qu'il en a lu, et de quoi corriger la
lecture sur place. Une correction faite là part avec l'import et le prochain export ne la
défera pas.

## Générer des jeux de test

```bash
cd tools
npm install
npm run generate                 # les 5 scénarios de volume
npm run generate -- --list       # la liste des scénarios disponibles
npm run generate -- --volume=balanced --stress=headliner,debutants
npm run generate -- --seed=7     # une autre graine, résultats reproductibles
```

Chaque scénario produit dans `tools/out/<scénario>/` :

| Fichier | Ce que c'est |
|---|---|
| `benevoles.csv` | Les réponses au formulaire, dans la forme d'un export Google Forms |
| `poles.csv` | Les pôles et sous-pôles, avec leurs règles spécifiques |
| `creneaux.csv` | Les créneaux, de durée variable, avec l'effectif nécessaire |
| `lineup.csv` | La programmation, qui définit les fenêtres artiste |
| `codes_acces.csv` | Les codes d'accès bénévoles, générés par l'outil |
| `resume.txt` | Le diagnostic du scénario: besoin, offre, écart, alertes |

Le résumé est la partie utile. Il dit si le scénario est réellement aussi tendu qu'il le
prétend, et il préfigure le tableau de bord de recrutement du régisseur.

## Les deux règles que le code applique partout

**Le temps se compte en heures décimales depuis le début de l'événement.** 0 vaut 12h00, 18 vaut
6h00 le lendemain. Les horodatages réels n'apparaissent qu'au tout dernier moment, à l'export.
Cela met les règles de planning hors de portée des questions de fuseau et de passage de minuit.

**Aucune règle de planning n'est une contrainte de base de données.** Le régisseur doit toujours
pouvoir enregistrer un planning temporairement incohérent et le voir signalé en rouge, jamais se
faire bloquer. Les règles vivent dans le moteur de validation, pas dans le schéma.

## Importer un CSV

```bash
cd tools
npm run import                                  # scénario "balanced"
npm run import -- --scenario=balanced+buddies
npm run import -- --file=chemin/vers/benevoles.csv --verbose
```

Les colonnes sont reconnues par mots-clés, pas par intitulé exact, donc une question reformulée
dans le formulaire ne casse pas l'import. Une colonne obligatoire introuvable est signalée, jamais
ignorée en silence.

Rien n'est jamais écarté. Une ligne incohérente est importée **et** signalée, parce que la marche
à suivre du régisseur est de rappeler la personne, pas de la perdre.
