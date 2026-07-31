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
            if (content.includes('.js\'')) {
                // Also fixing the wrong ../../../../dc/core path since the path aliases are enabled.
                // It is better to use the path alias dc/core/... or just remove .js
                content = content.replace(/\.js'/g, "'");
                fs.writeFileSync(file, content);
                console.log('Fixed', file);
            }
        }
    });
}

walk('./src');
