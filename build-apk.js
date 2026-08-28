const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isRelease = process.argv.includes('--release');
const buildType = isRelease ? 'Release' : 'Debug';
const apkFolderName = isRelease ? 'release' : 'debug';
const apkFileName = isRelease ? 'app-release.apk' : 'app-debug.apk';

console.log('\n=========================================');
console.log(`🚀 Iniciando la automatización de Build (${buildType})`);
console.log('=========================================\n');

try {
    // 1. Compilar el proyecto Angular
    console.log('1️⃣  Compilando la aplicación web (npm run build)...');
    execSync('npm run build', { stdio: 'inherit' });

    // 2. Sincronizar Capacitor
    console.log('\n2️⃣  Sincronizando Capacitor (npx cap sync android)...');
    execSync('npx cap sync android', { stdio: 'inherit' });

    // 3. Compilar el APK con Gradle
    console.log(`\n3️⃣  Compilando el APK (gradlew assemble${buildType})...`);
    const gradlewCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    execSync(`${gradlewCmd} assemble${buildType}`, { 
        cwd: path.join(__dirname, 'android'), 
        stdio: 'inherit' 
    });

    // 4. Copiar el APK a la carpeta public/apk
    console.log('\n4️⃣  Copiando el APK a la carpeta public/apk...');
    const publicApkDir = path.join(__dirname, 'public', 'apk');
    
    // Crear la carpeta si no existe
    if (!fs.existsSync(publicApkDir)) {
        fs.mkdirSync(publicApkDir, { recursive: true });
    }

    const apkSourcePath = path.join(__dirname, 'android', 'app', 'build', 'outputs', 'apk', apkFolderName, apkFileName);
    // You can rename the destination file if you prefer (e.g. trackingfy.apk)
    const apkDestPath = path.join(publicApkDir, apkFileName);

    if (fs.existsSync(apkSourcePath)) {
        fs.copyFileSync(apkSourcePath, apkDestPath);
        console.log(`\n✅ ¡APK (${buildType}) generado y copiado exitosamente en:`);
        console.log(`   👉 ${apkDestPath}`);
    } else {
        console.error('\n❌ Error: No se encontró el APK generado en la ruta esperada.');
        console.error(`   Esperado en: ${apkSourcePath}`);
        process.exit(1);
    }
} catch (error) {
    console.error('\n❌ Ocurrió un error durante el proceso de automatización.');
    console.error(error.message);
    process.exit(1);
}
