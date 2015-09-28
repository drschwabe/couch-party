##  Couch Party

ALPHA / WIP

A set of functions for building Couch/PouchDB driven multi-user apps.   Currently does basic login, registration, and user profile syncing. 

```
npm install couch-party
```


### Party time

```
//Login
var baseCouchURL = 'http://admin:admin@localhost:5984/myProject'
var login = {
    nickOrEmail: "Sarah", 
    password: 'w00t'
}
couchParty.login(baseCouchURL, login, function(err, doc) {
    if(err) console.log('You were not invited!')
    else console.log('Welcome to the party yo!')
})
```

```
//Register
var form = {
    nickname: 'Sarah', 
    email : 'sara@geemail.com', 
    password : 'w00t'
}
couchParty.register(baseCouchURL, form, function(err, couchRes) {
    if(err) console.log(err)
    else console.log('User created with doc._id of: ' couchRes.id)
})
```



### Sync time

There is also a function to sync client-side changes with help from PouchDB: 

```
//server.js
couchParty.syncEverybody(baseCouchURL)
```

Each user gets their own database.  In addition, a single 'mother' database is used for authentication.  syncEverybody function keeps changes from the individual user databases to the mother.  

On client side, now you can just save stuff to a browser PouchDB and let it's sync feature take care of the rest. 

```
//app.js (browser)
//First, get the user doc by logging in: 
var userDoc
$.post('http://localhost:4500/login', form, function(userDoc) {
//^ Assuming your server app is listening on 4500, and calls "couchParty.login" with the route above. 
    initPouch(userDoc)
}, 'json')

//Create a database based on the userDoc we got from server: 
function initPouch(userDoc) {
    var db = new PouchDB('myproject_user')
    db.post(userDoc, function(err, res) {
        //Now perform a live sync: 
        db.sync('http://admin:admin@localhost:5984/' + userDoc.db_name, { live: true, retry: true })
          .on('change', function(info) {
            console.log('Now this is a party!')
          })
    })
}
```

