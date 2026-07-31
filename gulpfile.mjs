import gulp from 'gulp';
import terser from 'gulp-terser';
import rename from 'gulp-rename';

gulp.task('build', (done) => {
  console.log('Building Dardcor Code...');
  done();
});

gulp.task('compile', (done) => {
  console.log('Compiling TypeScript...');
  done();
});

gulp.task('minify', () => {
  return gulp.src('src/**/*.js')
    .pipe(terser())
    .pipe(rename({ suffix: '.min' }))
    .pipe(gulp.dest('dist'));
});

gulp.task('package', (done) => {
  console.log('Packaging for distribution...');
  done();
});

gulp.task('upload', (done) => {
  console.log('Uploading artifacts...');
  done();
});

gulp.task('test', (done) => {
  console.log('Running tests...');
  done();
});

gulp.task('lint', (done) => {
  console.log('Running linter...');
  done();
});

gulp.task('watch', () => {
  gulp.watch('src/**/*', gulp.series('compile'));
});

gulp.task('default', gulp.series('build'));
