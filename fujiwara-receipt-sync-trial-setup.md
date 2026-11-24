# レシート経費申請 v3.0 試験環境の設定

1. プロジェクトIDが `fujiwara-receipt-trial-` で始まり、接尾辞が英小文字と数字の新規Firebaseプロジェクトを作成します。Realtime Databaseのデフォルトインスタンスをロックモードで作成します。
2. 下記のルールは、新規の試験用Realtime Databaseの「ルール」に公開します。
3. Authentication のメール／パスワード方式を有効にして、社長とスタッフの試験ユーザーを作成します。スタッフ間の権限確認用にスタッフを2人用意します。
4. データ画面で `roles` の直下に各試験ユーザーのUIDをキーとして、文字列 `ceo` または `staff` を設定します。
5. ウェブアプリを登録し、Firebaseが表示する設定オブジェクトをJSON形式で保存します。 `databaseURL` が含まれることを確認してください。設定JSONにはFirebaseのウェブアプリ設定だけを入れます。
6. 両端末で試験版を開いて、同じ設定JSONを選び、各自の試験アカウントでログインします。スタッフAで架空の写真付き申請を作り、社長画面に自動表示されること、スタッフBに表示されないこと、社長の判断がスタッフAに戻ることを確認します。会社払いとスタッフ立替でそれぞれ試します。

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "roles": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid"
      }
    },
    "applications": {
      ".read": "auth != null && root.child('roles').child(auth.uid).val() === 'ceo'",
      "$uid": {
        ".read": "auth != null && auth.uid === $uid && root.child('roles').child(auth.uid).val() === 'staff'",
        "$id": {
          "submission": {
            ".write": "auth != null && auth.uid === $uid && root.child('roles').child(auth.uid).val() === 'staff' && !data.exists() && newData.exists()",
            ".validate": "newData.hasChildren(['name','supplier','photo','date','amount','payment','event','note','createdAt'])",
            "name": {
              ".validate": "newData.isString() && newData.val().length <= 60 && newData.val().length > 0"
            },
            "supplier": {
              ".validate": "newData.isString() && newData.val().length <= 100 && newData.val().length > 0"
            },
            "photo": {
              ".validate": "newData.isString() && newData.val().length <= 2000000 && newData.val().beginsWith('data:image/jpeg;base64,')"
            },
            "date": {
              ".validate": "newData.isString() && newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)"
            },
            "amount": {
              ".validate": "newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= 1 && newData.val() <= 999999999"
            },
            "payment": {
              ".validate": "newData.val() === '会社のお金で購入' || newData.val() === 'スタッフ立替'"
            },
            "event": {
              ".validate": "newData.isString() && newData.val().length <= 100"
            },
            "note": {
              ".validate": "newData.isString() && newData.val().length <= 500"
            },
            "createdAt": {
              ".validate": "newData.isNumber() && newData.val() <= now"
            },
            "$other": {
              ".validate": false
            }
          },
          "decision": {
            ".write": "auth != null && root.child('roles').child(auth.uid).val() === 'ceo' && newData.exists() && root.child('applications').child($uid).child($id).child('submission').exists() && data.child('status').val() !== '確認済み（試験）'",
            ".validate": "newData.hasChildren(['status','reason','revision']) && (newData.child('status').val() !== '保留（試験）' || newData.child('reason').val().length > 0)",
            "status": {
              ".validate": "newData.val() === '保留（試験）' || newData.val() === '確認済み（試験）'"
            },
            "reason": {
              ".validate": "newData.isString() && newData.val().length <= 500"
            },
            "revision": {
              ".validate": "newData.isNumber() && ((!data.exists() && newData.val() === 1) || (data.exists() && newData.val() === data.val() + 1))"
            },
            "$other": {
              ".validate": false
            }
          }
        }
      }
    }
  }
}
```
