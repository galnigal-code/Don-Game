# Don Game

משחק מרוץ מכוניות תלת-ממדי לטלפון, בדפדפן. מנווטים בהטיית הטלפון כמו הגה, אוספים קופסאות הפתעה ומכשילים את היריבים.

- איפיון מוצר: [docs/SPEC.md](docs/SPEC.md)
- איפיון טכני: [docs/TECH_SPEC.md](docs/TECH_SPEC.md)
- משחק (אחרי שלב M0): https://galnigal-code.github.io/Don-Game/

סטטוס: M1 (מסלול ונסיעה) הושלם. הבנייה ממשיכה לפי [TECH_SPEC §17](docs/TECH_SPEC.md).

## פיתוח

```bash
npm install
npm run dev      # שרת פיתוח
npm test         # בדיקות יחידה
npm run build    # בנייה ל-dist
npm run smoke    # בדיקת עשן ב-Chromium (אחרי build + preview)
```

## בקרות בשלב הנוכחי (M1)

- מקלדת: חצים / A,D להיגוי, Shift או חץ למעלה לטורבו, R להתחלה מחדש
- טלפון (זמני עד M2): נגיעה בחצי השמאלי / הימני של המסך להיגוי, כפתור האש לטורבו
- פרמטרים בכתובת: `?debug=1` (FPS ונתונים), `?autopilot=1` (נהג אוטומטי), `?fast=4`, `?seed=N`
