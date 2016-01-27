// Licensed under the Apache License, Version 2.0 (the 'License'); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations under
// the License.

'use strict';

// Required Modules
require('dotenv').load({ silent: true });
var Hapi = require('hapi');
var Path = require('path');
var Cloudant = require('cloudant');

// Config services
// Validate
if (typeof process.env.VCAP_SERVICES === 'undefined' ||
  typeof process.env.DATABASE === 'undefined') {
  throw new Error('Missing ENV variables');
}

// VCAP Services
var vcapServices = JSON.parse(process.env.VCAP_SERVICES);

// Setup Cloudant
var cloudantCreds = vcapServices.cloudantNoSQLDB[0].credentials;
var cloudant = Cloudant({
  account: cloudantCreds.username,
  password: cloudantCreds.password,
});
var database = process.env.DATABASE;

// Instantiate the server
var server = new Hapi.Server({
  debug: {
    request: ['error', 'good'],
  },
  connections: {
    routes: {
      files: {
        relativeTo: Path.join(__dirname, 'public'),
      },
    },
  },
});

// Set the Hapi Connection
server.connection({
  host: process.env.VCAP_APP_HOST || 'localhost',
  port: process.env.VCAP_APP_PORT || process.env.PORT || 3000,
  routes: {
    cors: true,
  },
});

// Error return
var errorFunc = function(error, callback) {
  callback({
    error: error.message,
  }).code(error.statusCode);
};

// Process security
var processSecurity = function(database, api, reply) {
  var db = cloudant.db.use(database);

  // Or you can read the security settings from a database.
  db.get_security(function(er, result) {
    if (er) {
      errorFunc(er, reply);
    } else {
      var security = (result.cloudant) ? result.cloudant : {};
      security[api.key] = ['_reader', '_writer', '_replicator'];

      db.set_security(security, function(er, result) {
        if (er) {
          errorFunc(er, reply);
        } else {
          var url = 'https://' +
          api.key +
          ':' +
          api.password +
          '@' +
          cloudantCreds.host +
          '/' +
          database;
          reply({
            url: url,
          }).code(200);
        }
      });
    }
  });
}

// Route to return the url to access a Cloudant DB
server.route({
    method: ['GET', 'POST'], // Must handle both GET and POST
    path: '/',          // The callback endpoint registered with the provider
    handler: (request, reply) => {
      cloudant.generate_api_key(function(er, api) {
        if (er) {
          throw er; // You probably want wiser behavior than this.
        };

        if (process.env.DBPERUSER) {
          database = (request.params.user) ? request.params.user :
            ((request.query.user) ? request.query.user : api.key);
          cloudant.db.get(database, function(err, body){
            if (err) {
              cloudant.db.create(database, function(err, body) {
                if (err) {
                  errorFunc(err, reply);
                } else {
                  processSecurity(database, api, reply);
                }
              });
            } else {
              processSecurity(database, api, reply);
            }
          });
        } else {
          processSecurity(database, api, reply);
        }
      });
    },
  });

// Hapi Log
server.log(['error', 'database', 'read']);

// Start Hapi
server.start(function(err) {
  if (err) {
    console.log(err);
  } else {
    console.log('Server started at: ' + server.info.uri);
  }
});
