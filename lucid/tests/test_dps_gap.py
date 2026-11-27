"""
Non-régression de la décomposition de l'écart de DPS (« D'où vient l'écart de DPS »).

Pour chaque étape d'un guide, la comparaison pose sur le perso, étape par étape, l'équipement, l'arbre, les gemmes,
les réglages du personnage, l'onglet Party et les lignes ajoutées par l'auteur. À la fin, le perso doit avoir le
DPS du guide : la part « Le reste » doit valoir ×1,00 (tolérance ±2 %). À relancer après chaque mise à jour de PoB.

Vérifie aussi qu'aucune comparaison ne laisse de trace dans le build chargé (groupes « Item:Lucid: »).

Usage :
    python tests/test_dps_gap.py "<guide.xml>" "<perso.xml>" [titre d'étape …]
Sans argument : le guide et le perso de référence de la bibliothèque, étapes 2, 4, 9, 13, 17, 20 et 22.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import server  # noqa: E402

GUIDE = "Animate Guardian's Weapon - Necromancer (Witch).xml"
MINE = "Necro suivi du guide.xml"
STAGES = ["Etape 2 ", "Etape 4", "Etape 9", "Etape 13", "Etape 17", "Etape 20", "Etape 22"]
TOL = 0.02


def main():
    args = sys.argv[1:]
    gid = args[0] if len(args) > 0 else GUIDE
    mid = args[1] if len(args) > 1 else MINE
    stages = args[2:] or STAGES
    server.HOST = server.EngineHost()
    G = server.HOST.open(gid, None)
    failed = 0
    for title in stages:
        trees = [t for t in G["sets"]["trees"] if t["title"].startswith(title)]
        if not trees:
            print("?? %-12s étape introuvable" % title)
            failed += 1
            continue
        st = server.match_stage(G["sets"], trees[0]["id"])
        R = server.compare(gid, st, mid)
        errs = [r["slot"] for r in R["items"] if r.get("error")]
        D = R.get("dpsGap")
        rest = next((p["mult"] for p in (D or {}).get("parts", []) if p["key"] == "rest"), None)
        leak = [x for x in server.HOST.call("snapshot").get("skills", []) if str(x.get("source") or "").startswith("Item:Lucid")]
        ok = (D is None or (rest is not None and abs(rest - 1) <= TOL)) and not errs and not leak
        failed += not ok
        print("%s %-12s reste %s%s%s" % ("ok" if ok else "!!", title, "—" if rest is None else "x%.3f" % rest,
                                         "  erreurs objets: %s" % errs if errs else "", "  fuite: %d groupe(s)" % len(leak) if leak else ""))
    print("échecs : %d / %d" % (failed, len(stages)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
