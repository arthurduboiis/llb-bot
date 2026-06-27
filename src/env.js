const path = require('path');
const dotenv = require('dotenv');

const envFile = process.argv[2] || '.env.prod';
dotenv.config({ path: path.join(__dirname, '..', envFile) });

console.log(`🔧 Environnement chargé : ${envFile}`);
