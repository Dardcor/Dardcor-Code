const fs = require('fs');
const path = require('path');

function walk(dir) {
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            walk(file);
        } else if (file.endsWith('.ts')) {
            let content = fs.readFileSync(file, 'utf8');
            if (content.includes('../../../../dc/core')) {
                // Remove the extra dc/ or just replace it with the alias dc/core
                content = content.replace(/\.\.\/\.\.\/\.\.\/\.\.\/dc\/core/g, 'dc/core');
                fs.writeFileSync(file, content);
                console.log('Fixed path', file);
            }
        }
    });
}

walk('./src');
