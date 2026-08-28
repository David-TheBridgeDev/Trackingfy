const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('\n=========================================');
console.log('🚀 Iniciando proceso automático de Release');
console.log('=========================================\n');

try {
    // 1. Determinar el tipo de incremento (patch por defecto)
    // Puede ser: patch (1.0.x), minor (1.x.0), major (x.0.0)
    const args = process.argv.slice(2);
    const type = args[0] && ['patch', 'minor', 'major'].includes(args[0]) ? args[0] : 'patch';

    // 2. Incrementar versión en package.json sin hacer el tag aún
    console.log(`📦 Incrementando la versión (${type})...`);
    execSync(`npm version ${type} --no-git-tag-version`, { stdio: 'inherit' });

    // 3. Leer la nueva versión asignada
    const packageJsonPath = path.join(__dirname, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const newVersion = packageJson.version;
    console.log(`\n✅ Nueva versión asignada: v${newVersion}`);

    // 4. Sincronizar el archivo de traducciones (UI de Angular)
    console.log('\n📝 Actualizando versión en src/app/services/translation.ts...');
    const translationPath = path.join(__dirname, 'src', 'app', 'services', 'translation.ts');
    let translationContent = fs.readFileSync(translationPath, 'utf8');
    
    // Reemplaza exactamente "version = 'x.x.x';" por la nueva
    translationContent = translationContent.replace(/version = '.*';/, `version = '${newVersion}';`);
    fs.writeFileSync(translationPath, translationContent);

    // 5. Añadir cambios a Git, hacer commit y crear el Tag
    console.log('\n💾 Creando commit y Tag en Git...');
    execSync('git add package.json package-lock.json src/app/services/translation.ts', { stdio: 'inherit' });
    execSync(`git commit -m "chore: release v${newVersion}"`, { stdio: 'inherit' });
    execSync(`git tag v${newVersion}`, { stdio: 'inherit' });

    // 6. Subir todo a GitHub (esto dispara la Action)
    console.log('\n☁️ Subiendo cambios a GitHub...');
    execSync('git push', { stdio: 'inherit' });
    execSync(`git push origin v${newVersion}`, { stdio: 'inherit' });

    console.log(`\n🎉 ¡Versión v${newVersion} subida con éxito!`);
    console.log('GitHub Actions está compilando ahora mismo tu APK. 🚀\n');

} catch (error) {
    console.error('\n❌ Ocurrió un error durante la release:');
    console.error(error.message);
    process.exit(1);
}
