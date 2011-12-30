var fs = require('fs'),
    url = require('url'),
    querystring = require('querystring'),
    connect = require('connect'),
    Inliner = require('inliner'),
    port = parseInt(process.argv[2], 10) || 80,
    inliners = {};

var routes = function (app) {
  app.get("/progress", function (req, res) {
    var job = req.query.job;
    if (job && inliners[job] !== undefined) {
      inliners[job].inliner.active = true;
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'});
      res.write('id:0\n\n');
      
      inliners[job].inliner.on('progress', function (status) {
        res.write('data: ' + status + '\n\n');
      });

      inliners[job].inliner.on('jobs', function (total) {
        res.write('data: jobs ' + total + '\n\n');
      });
      
      inliners[job].inliner.on('done', function (url) {
        fs.stat(__dirname + '/public' + url, function (err, stat) {
          var size = '';
          if (!err) {
            size = ' ' + (0|stat.size / 1024) + 'K';
          }
          res.write('data: complete ' + url + size + '\n\n');
          delete inliners[job];
        });
      });
      
      inliners[job].inliner.on('error', function (error) {
        res.write('data: error ' + error + '\n\n');
      });
      
      if (inliners[job].inliner.dirty) {
        res.write('data: error url could not be requested\n\n');
      }
    } else {
      res.writeHead(404);
      res.end('Job number required');
    }
  });
  
  app.get('/inline', function (req, res) {
    if (req.query.url) {
      
      if (req.query.url.indexOf('http') !== 0) {
        req.query.url = 'http://' + req.query.url;
      }
            
      var job = connect.utils.uid(10);
      console.log((new Date).toUTCString() + ' ' + req.query.url + ' (' + job + ')');
      
      var options = Inliner.defaults();
      
      if (req.query.nocompress) {
        options.compressCSS = false
        options.collapseWhitespace = false;
      }

      if (req.query.noimages) {
        options.images = false;
      }
      
      inliners[job] = {
        inliner: new Inliner(req.query.url, options)
      };
      
      inliners[job].inliner.on('end', function (html) {
        if (html) {
          fs.writeFile(__dirname + '/public/jobs/' + job + '.html', html, function (err) {
            if (err) {
              inliners[job].inliner.emit('error', err);
            } else {
              inliners[job].inliner.emit('done', '/jobs/' + job + '.html');
            }
          });
        } else {
          // this event fires before the event stream is setup, so we 
          // need to flag the job as broken, and when the stream opens
          // send back that the job failed.
          if (inliners[job].inliner.active) {
            // emit event
            inliners[job].inliner.emit('error', 'url could not be requested');
          } else {
            inliners[job].inliner.dirty = true;
          }
        }
      });
      
      if (req.headers['x-requested-with'] == 'XMLHttpRequest') {
        // xhr
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ job: job }));
        // res.end(JSON.stringify({ error: 'url not defined' }));
      } else {
        // regular
        inliners[job].inliner.on('done', function (url) {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<a href="' + url + '">' + url + '</a>');
        });
        
        inliners[job].inliner.on('error', function (err) {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<p>Failed to complete job: ' + err + '</p>');
        });
      } 
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('No url provided.');
    }
  });
};

connect.createServer(
  function (req, res, next) {
    var query = {};
    
    if (req.url.indexOf('?') !== -1) {
      query = querystring.parse(url.parse(req.url).query);
    }
    
    req.query = query;
    next();
  },
  function (req, res, next) {
    if (req.url.indexOf('/jobs/') === 0) {
      if (~req.url.indexOf('..')) {
        next(new Error('Forbidden'));
      } else {
        var path = __dirname + '/public' + req.url;  
        fs.stat(path, function (err, stat) {
          if (err) {
            return next(err);
          }
          
          if (stat.isDirectory()) {
            return next(new Error('Cannot Transfer Directory'));
          }

          res.setHeader('content-length', stat.size);
          res.setHeader('content-type', 'application/octet-stream');
          res.setHeader('content-disposition', 'attachment; filename=' + req.url.split('/').pop());
          var stream = fs.createReadStream(path);
          stream.pipe(res);
        });
      }
    } else {
      next();
    }
  },
  connect.static(__dirname + '/public'),
  connect.router(routes)
).listen(port);

