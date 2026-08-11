const { execSync } = require('child_process');
const fs = require('fs');

try {
    const stdout = execSync('git grep -l "Microsoft Corporation"', { encoding: 'utf-8' });
    const files = stdout.split('\n').filter(Boolean);
    let count = 0;
    
    for (const file of files) {
        try {
            const content = fs.readFileSync(file, 'utf-8');
            if (content.includes('Microsoft Corporation')) {
                const newContent = content.replace(/Microsoft Corporation/g, 'Dardcor Corporation');
                fs.writeFileSync(file, newContent, 'utf-8');
                count++;
            }
        } catch (e) {
            console.error('Failed to process ' + file + ': ' + e.message);
        }
    }
    console.log('Successfully updated ' + count + ' files.');
} catch (e) {
    console.error('Error running git grep');
}
