# Packaged artifact fonts

Generated pages run without font CDNs. Their trusted frame stylesheet packages the widest practical Unicode-range builds for the following OFL families:

| Role | Packaged families | Included coverage |
| --- | --- | --- |
| UI sans | Arimo Variable, Source Sans 3 Variable, Roboto Condensed Variable | Latin Extended, Cyrillic Extended, Greek Extended, Hebrew where supplied, Vietnamese |
| Serif | Tinos, Gelasio Variable, Noto Serif Variable | Latin Extended, Cyrillic Extended, Greek Extended, Hebrew where supplied, Vietnamese, math |
| Mono | Cousine, Noto Sans Mono Variable | Latin Extended, Cyrillic Extended, Greek Extended, Hebrew where supplied, Vietnamese |
| Display | Comic Neue, Anton, Archivo Black | The complete subsets published with each family |
| Global fallback | Noto Sans Variable, Noto Sans Arabic Variable, Noto Sans Hebrew Variable, Noto Sans Thai Variable, Noto Sans Devanagari Variable | Latin Extended, Cyrillic Extended, Greek Extended, Vietnamese, Arabic, Hebrew, Thai, Devanagari, math and symbols where supplied |
| CJK fallback | Noto Sans JP, Noto Sans KR, Noto Sans SC, Noto Sans TC | Japanese, Korean, Simplified Chinese and Traditional Chinese regional sets |

The build also creates CSS compatibility aliases. Each alias first tries a legally installed local original, then uses the packaged open font without changing the embedded font binary or its primary family metadata:

- Arial, Verdana and MS Sans Serif → Arimo Variable
- Times New Roman and MS Serif → Tinos
- Courier New and Monaco → Cousine
- Arial Narrow → Roboto Condensed Variable
- Tahoma, Trebuchet MS, Lucida Sans Unicode, Helvetica Neue, Helvetica, Geneva, Lucida Grande, Myriad and Myriad Pro → Source Sans 3 Variable
- Georgia → Gelasio Variable
- Comic Sans MS → Comic Neue
- Impact → Anton
- Arial Black → Archivo Black

Font files are sourced through [Fontsource](https://fontsource.org/) from the upstream [Google Fonts repository](https://github.com/google/fonts) and [Noto CJK project](https://github.com/notofonts/noto-cjk). All packaged families are distributed under the SIL Open Font License 1.1. A copy ships at [`public/fonts/OFL-1.1.txt`](../public/fonts/OFL-1.1.txt); individual copyright records remain embedded in the WOFF2 font metadata and in each installed Fontsource package.
