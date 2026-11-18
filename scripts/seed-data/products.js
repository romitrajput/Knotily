// Demo catalogue used only to build supabase/seed.sql for the Testing environment.

const C = {
  latex: { name: 'Latex Black', hex: '#141214' },
  hot: { name: 'Hot Pink', hex: '#FF2D87' },
  redlight: { name: 'Red Light', hex: '#E0002A' },
  cherry: { name: 'Cherry Bomb', hex: '#A8001F' },
  gloss: { name: 'Lip Gloss', hex: '#F6B3CB' },
  bruise: { name: 'Bruise', hex: '#4B1D6B' },
  wine: { name: 'Hangover', hex: '#5A0F24' },
  lace: { name: 'White Lace', hex: '#F1E6E9' },
  poison: { name: 'Poison', hex: '#9BE22B' },
  ice: { name: 'Cold Shoulder Blue', hex: '#8EC9FF' },
};
const ink = (c, hex) => ({ ...c, ink: hex });

const APPAREL = ['XS', 'S', 'M', 'L', 'XL'];

export const CATEGORIES = [
  { id: 'tees', label: 'Oversized tees', blurb: 'Heavyweight, dropped-shoulder tees cut big on purpose. Say it on the front, mean it on the back.' },
  { id: 'tops', label: 'Tops', blurb: 'Tees, tanks and halters that show just enough.' },
  { id: 'outerwear', label: 'Outerwear', blurb: 'Hoodies and jackets you pull, lace and loosen.' },
  { id: 'bottoms', label: 'Bottoms', blurb: 'Cargos and minis with drawcords at the waist.' },
];

const TEE_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const TEE_DETAILS = ['260 GSM heavyweight cotton', 'Oversized fit with dropped shoulders', 'Size down for a closer fit', 'Machine wash cold, inside out'];

export const PRODUCTS = [
  {
    id: 't01', slug: 'bad-idea-oversized-tee', name: 'Bad Idea Oversized Tee', category: 'tees', art: 'oversized',
    price: 1590, drop: 4, isNew: true,
    colors: [C.redlight, ink(C.latex, '#FF1F3D'), C.lace], sizes: TEE_SIZES,
    print: { front: ['bad idea'], frontStyle: 'chest', back: ['BAD', 'IDEA'], sub: 'GOOD TIME GUARANTEED' },
    description: '"bad idea" on the chest, "BAD IDEA / good time guaranteed" across the back.',
    details: TEE_DETAILS,
  },
  {
    id: 't02', slug: 'not-your-baby-oversized-tee', name: 'Not Your Baby Oversized Tee', category: 'tees', art: 'oversized',
    price: 1590, drop: 4, isNew: true,
    colors: [C.hot, ink(C.latex, '#FF2D87'), C.gloss], sizes: TEE_SIZES,
    print: { front: ['NOT YOUR', 'BABY'], frontSize: 0.15, back: ['BACK', 'OFF'] },
    description: 'Boxy oversized tee with "NOT YOUR BABY" across the chest and "BACK OFF" on the back.',
    details: TEE_DETAILS,
  },
  {
    id: 't03', slug: 'after-hours-oversized-tee', name: 'After Hours Oversized Tee', category: 'tees', art: 'oversized',
    price: 1690, drop: 4, isNew: true, stock: 'low',
    colors: [ink(C.latex, '#FF2D87'), C.bruise, C.lace], sizes: TEE_SIZES,
    print: { front: ['after hours'], frontStyle: 'chest', back: ['AFTER', 'HOURS'], sub: 'OPEN TILL LATE' },
    description: 'The black tee for after dark. "AFTER HOURS / open till late" on the back.',
    details: TEE_DETAILS,
  },
  {
    id: 't04', slug: 'poison-oversized-tee', name: 'Poison Oversized Tee', category: 'tees', art: 'oversized',
    price: 1590, drop: 4, isNew: true,
    colors: [C.poison, ink(C.latex, '#9BE22B')], sizes: TEE_SIZES,
    print: { front: ['POISON'], frontSize: 0.2, back: ['HANDLE', 'WITH', 'CARE'], backSize: 0.2 },
    description: 'Acid-bright oversized tee. "POISON" on the front, "handle with care" on the back.',
    details: TEE_DETAILS,
  },
  {
    id: 't05', slug: 'velvet-rope-oversized-tee', name: 'Velvet Rope Oversized Tee', category: 'tees', art: 'oversized',
    price: 1690, drop: 4,
    colors: [C.bruise, C.hot], sizes: TEE_SIZES,
    print: { front: ['VIP'], frontSize: 0.3, back: ['ON THE', 'LIST'], sub: 'PLUS ONE: NOBODY' },
    description: '"VIP" up front, "on the list / plus one: nobody" on the back.',
    details: TEE_DETAILS,
  },
  {
    id: 't06', slug: 'lip-service-oversized-tee', name: 'Lip Service Oversized Tee', category: 'tees', art: 'oversized',
    price: 1590, drop: 4,
    colors: [ink(C.gloss, '#A8001F'), C.redlight], sizes: TEE_SIZES,
    print: { front: ['lip service'], frontStyle: 'chest', back: ['ALL', 'TALK'], sub: 'NO ACTION' },
    description: 'Soft pink oversized tee. "lip service" on the chest, "ALL TALK / no action" on the back.',
    details: TEE_DETAILS,
  },
  {
    id: 't07', slug: 'cold-shoulder-oversized-tee', name: 'Cold Shoulder Oversized Tee', category: 'tees', art: 'oversized',
    price: 1590, drop: 4, isNew: true,
    colors: [C.ice, C.lace], sizes: TEE_SIZES,
    print: { front: ['cold shoulder'], frontStyle: 'chest', back: ["DON'T", 'TEXT', 'FIRST'], backSize: 0.2 },
    description: 'Ice-blue oversized tee for when you\'re not replying. "DON\'T TEXT FIRST" on the back.',
    details: TEE_DETAILS,
  },
  {
    id: 't08', slug: 'white-lie-oversized-tee', name: 'White Lie Oversized Tee', category: 'tees', art: 'oversized',
    price: 1590, drop: 4,
    colors: [ink(C.lace, '#E0002A'), ink(C.latex, '#F1E6E9')], sizes: TEE_SIZES,
    print: { front: ['WHITE', 'LIE'], frontSize: 0.17, back: ['I WAS', 'NEVER', 'HERE'], backSize: 0.2 },
    description: 'Clean white oversized tee with a red "WHITE LIE" and "I was never here" on the back.',
    details: TEE_DETAILS,
  },
  {
    id: 'p01', slug: 'tied-up-boxy-tee', name: 'Tied Up Boxy Tee', category: 'tops', art: 'tee',
    price: 1490, drop: 4, isNew: true,
    colors: [C.latex, C.hot, C.lace], sizes: APPAREL,
    description: 'Heavyweight boxy tee. "Tied up right now" on the front, "loose ends" across the back.',
    details: ['240 GSM combed cotton', 'Boxy, dropped-shoulder fit', 'Puff print front, screen print back', 'Machine wash cold, inside out'],
  },
  {
    id: 'p02', slug: 'no-strings-tank', name: 'No Strings Tank', category: 'tops', art: 'tank',
    price: 1190, drop: 4, isNew: true, stock: 'low',
    colors: [C.redlight, C.latex, C.gloss], sizes: APPAREL,
    description: 'Washed rib tank with hand-distressed holes. "No strings" on the front, "attached" on the back.',
    details: ['100% cotton rib, garment washed', 'Distressed by hand, so no two match', 'Slim, slightly cropped fit'],
  },
  {
    id: 'p03', slug: 'barely-there-halter', name: 'Barely There Halter', category: 'tops', art: 'halter',
    price: 1290, drop: 4,
    colors: [C.hot, C.latex, C.redlight], sizes: APPAREL,
    description: 'Gathered halter with a satin neck strap and an open back. Pairs with the Trouble Mini.',
    details: ['Cotton poplin with satin strap', 'Adjustable neck strap', 'Elasticated back hem'],
  },
  {
    id: 'p04', slug: 'pull-me-hoodie', name: 'Pull Me Hoodie', category: 'outerwear', art: 'hoodie',
    price: 2490, drop: 4, isNew: true,
    colors: [C.latex, C.wine, C.bruise], sizes: APPAREL,
    description: 'Oversized brushed-back hoodie with thick flat drawcords and a kangaroo pocket. "Made to be undone" on the back.',
    details: ['420 GSM brushed fleece', 'Flat drawcords with metal tips', 'Back print'],
  },
  {
    id: 'p05', slug: 'unlace-me-varsity', name: 'Unlace Me Varsity', category: 'outerwear', art: 'jacket',
    price: 4990, drop: 4, isNew: true, stock: 'low',
    colors: [
      { name: 'Red Light', hex: '#C4001F', hex2: '#141214', tie: '#FF2D87' },
      { name: 'Latex Black', hex: '#141214', hex2: '#FF2D87', tie: '#FF2D87' },
    ],
    sizes: APPAREL,
    description: 'Wool-blend varsity with contrast sleeves and a lace-up front in place of snaps. Chenille "k" patch.',
    details: ['Wool-blend body, faux leather-look sleeves', 'Lace-up front', 'Striped rib collar, cuffs and hem', 'Dry clean only'],
  },
  {
    id: 'p06', slug: 'second-skin-long-sleeve', name: 'Second Skin Long Sleeve', category: 'tops', art: 'longsleeve',
    price: 1690, drop: 3,
    colors: [C.gloss, C.latex, C.lace], sizes: APPAREL,
    description: 'Fitted long sleeve in stretch jersey with "don\'t be shy" running down one sleeve.',
    details: ['Cotton-modal stretch jersey', 'Body-skimming fit', 'Sleeve print'],
  },
  {
    id: 'p07', slug: 'loosen-up-cargo', name: 'Loosen Up Cargo', category: 'bottoms', art: 'pants',
    price: 2290, drop: 4,
    colors: [C.latex, C.wine, C.bruise], sizes: APPAREL,
    description: 'Straight-leg cargo with a drawcord waist and flap pockets on both thighs.',
    details: ['Cotton ripstop', 'Drawcord and belt loops', 'Six pockets'],
  },
  {
    id: 'p08', slug: 'trouble-mini', name: 'Trouble Mini', category: 'bottoms', art: 'skirt',
    price: 1390, drop: 4, isNew: true,
    colors: [C.redlight, C.latex, C.hot], sizes: APPAREL,
    description: 'Wrap mini skirt with a high split at the hip. Built-in shorts underneath.',
    details: ['Poly-viscose twill', 'Wrap front with built-in shorts', 'Hidden hook closure'],
  },
];
