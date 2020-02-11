## Build Instructions

1. Install dependencies: `rush update`
2. Rebuild source: `rush rebuild`

## Pour builder juste une partie

Il faut faire la commande `rush rebuild -f <packageName>`

Pour trouver le packageName de la partie qu'on veut builder, il suffit de regarder dans le `rush.json` à la racine du repo.

Par exemple, pour builder `ninezone-sample-app`, on regarde dans le `rush.json` et on a:

```
    {
      "packageName": "ninezone-sample-app",
      "projectFolder": "app/ninezone-sample-app",
      "reviewCategory": "internal"
    }
```

Donc il faut faire: `rush rebuild -f ninezone-sample-app`.
