Remove-Item -Recurse -Force ./dist
yarn tsc
Copy-Item -Recurse lang dist/lang
Copy-Item bin/hs dist/bin/hs
Copy-Item bin/hscms dist/bin/hscms
Copy-Item README.md dist/README.md
Copy-Item LICENSE dist/LICENSE
yarn compress-dist