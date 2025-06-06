# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.0.3](https://github.com/EastSun5566/vibe/compare/v0.0.2...v0.0.3) (2025-06-06)


### Bug Fixes

* template problem ([f87b0cd](https://github.com/EastSun5566/vibe/commit/f87b0cda11d45993b14bba197d25952508265ecd))

### [0.0.2](https://github.com/EastSun5566/vibe/compare/v0.0.1...v0.0.2) (2025-06-06)

### 0.0.1 (2025-06-06)


### Features

* add blog template with RSS feed, global constants, and layout components ([324150e](https://github.com/EastSun5566/vibe/commit/324150e1ca26e2a11fe20ac197691745323378c9))
* add option to skip style transformation during build ([3864f96](https://github.com/EastSun5566/vibe/commit/3864f9688ac51cf20aa85bca9574b9b4c8092d34))
* add simple logger ([8e8fa9f](https://github.com/EastSun5566/vibe/commit/8e8fa9f996d904c1a98638514c1f855d1e30052b))
* enhance `StyleTransformer` with detailed CSS variable extraction and theming support ([abd4f18](https://github.com/EastSun5566/vibe/commit/abd4f188689762aed7bd2f8a6032b46120a03b59))
* enhance base font family ([9af5174](https://github.com/EastSun5566/vibe/commit/9af5174e9670f12afd61de3793d6d05845b66c0a))
* enhance blog content structure with description and date updates ([8d41f47](https://github.com/EastSun5566/vibe/commit/8d41f47006f4e72a94e4c1fd14cf010bf67cb263))
* enhance log ([bf06f9f](https://github.com/EastSun5566/vibe/commit/bf06f9fb32c39c12c72a3f4541af7f1656160e11))
* impl cli for dev and build command ([6b457e6](https://github.com/EastSun5566/vibe/commit/6b457e64097f313d231bee0079517e6338a1061f))
* impl dev server ([4b22240](https://github.com/EastSun5566/vibe/commit/4b22240d7c9e6808a2765b533da83e5ef5e29997))
* impl own vibe toolbar integration ([6541245](https://github.com/EastSun5566/vibe/commit/654124578bc60b9a6e68f7d80e62e40f71bcfeba))
* implement HackMD content provider ([b191c50](https://github.com/EastSun5566/vibe/commit/b191c507d86a955bf2beac46b330f7628fe4e415))
* only transform css var for now ([f83f9ec](https://github.com/EastSun5566/vibe/commit/f83f9ecd384096fc833e54a8ca07c53bad3a1b4a))
* refactor blog styles ([369ab41](https://github.com/EastSun5566/vibe/commit/369ab414d8dab9ea4f02ac24ec16eb4b46f93bf6))
* refactor structure & add adapters ([5112f5f](https://github.com/EastSun5566/vibe/commit/5112f5f61b295053174b3bb92718ba4d10c4d8b4))
* refactor to more function style ([7c86d24](https://github.com/EastSun5566/vibe/commit/7c86d24d2ac6034d3638df9170b00af49fdac92c))
* replace all log to use logger ([6da76e6](https://github.com/EastSun5566/vibe/commit/6da76e62e1381d0626ce3b30e831e4592abd09b1))
* separate get author api ([e716199](https://github.com/EastSun5566/vibe/commit/e7161991580f0885858dc6e17960ad55197a9677))
* simplify toolbar ([be102d3](https://github.com/EastSun5566/vibe/commit/be102d3254e1062d52faabf47398112ca1d545fe))
* switch builder from vitepress to astro ([79e07a1](https://github.com/EastSun5566/vibe/commit/79e07a155830888c5ead172ca45f8d16194b5bae))
* transform style instead of html ([ba4690a](https://github.com/EastSun5566/vibe/commit/ba4690adce812e437108eea0e8583fedd264f4fb))
* update content provider interface ([631dca3](https://github.com/EastSun5566/vibe/commit/631dca3cc782f873b6a24125d031d4d8128e580a))
* update project name to vibelog ([5ce9c08](https://github.com/EastSun5566/vibe/commit/5ce9c087a38de3eb05139bbeac2790247eb35c61))
* update temp ([d9d4bcd](https://github.com/EastSun5566/vibe/commit/d9d4bcdda5725e87526bc5a0cce8952df89164ed))
* update toolbar styles and improve global CSS variables ([c521e43](https://github.com/EastSun5566/vibe/commit/c521e434921b5a8098702257c620beef5854ffec))
* use css parser for variable extraction and transformation ([736bb1b](https://github.com/EastSun5566/vibe/commit/736bb1b6504ce7b5f15da9148f17695a30d65dd5))
* use zod to create schema ([353efd5](https://github.com/EastSun5566/vibe/commit/353efd577c5c174c54349cdb7a5b5f69c1ca2ed0))


### Bug Fixes

* `.gitignore` should not ignore content folder ([504cec0](https://github.com/EastSun5566/vibe/commit/504cec046b3fa054cc18c7332dc783047dc680b1))
* add missing variable ([882809c](https://github.com/EastSun5566/vibe/commit/882809c5f7f0f79f7d151cf92c6ca5828324201d))
* correct regex for matching :root section in original CSS ([87f5833](https://github.com/EastSun5566/vibe/commit/87f5833c732cf101579c1e86f4078d7147bde00a))
* fetch hackdmd full content using download api ([ebf8530](https://github.com/EastSun5566/vibe/commit/ebf85308d2de422485dc30231d17d4efaf8abf79))
* HackMD content provider check ([aeed4c6](https://github.com/EastSun5566/vibe/commit/aeed4c6382e780ff42bd3ea23e297e1f0bed35a0))
* tweak input styles ([9f78d2f](https://github.com/EastSun5566/vibe/commit/9f78d2f75e74daece36781a062a8dc573240f71c))
* update build scripts ([bdc211d](https://github.com/EastSun5566/vibe/commit/bdc211d01c3c579e766753bdcd37cb0989de9ff3))
* update color variables ([3475d70](https://github.com/EastSun5566/vibe/commit/3475d70ede4ff247548a6e909046315fa1ba5d4d))
