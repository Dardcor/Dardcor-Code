const gulp = require('gulp');

gulp.task('build', (done) => {
    console.log('Building Dardcor Code...');
    done();
});

gulp.task('compile', (done) => {
    console.log('Compiling typescript...');
    done();
});

gulp.task('package', (done) => {
    console.log('Packaging application...');
    done();
});

gulp.task('test', (done) => {
    console.log('Running tests...');
    done();
});

gulp.task('default', gulp.series('build', 'compile'));
