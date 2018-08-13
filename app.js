var express = require("express");
var fs = require("fs");
var aws = require("ibm-cos-sdk");

var vcap = {};
if(process.env.VCAP_SERVICES){
  vcap = JSON.parse(process.env.VCAP_SERVICES);
}
else vcap = JSON.parse(fs.readFileSync("local-env.json"));

// create a new express server
var app = express();
var router = express.Router();

var cosConfig = {
  endpoint: "s3.ams03.objectstorage.softlayer.net", // Depends where bucket was created
  apiKeyId: vcap["cloud-object-storage"][0].credentials.apikey,
  ibmAuthEndpoint: "https://iam.ng.bluemix.net/oidc/token",
  serviceInstanceId: vcap["cloud-object-storage"][0].credentials.resource_instance_id
}

var cos = new aws.S3(cosConfig);

router.use("/", express.static(__dirname + "/public"));

router.get("/3/video/:filename", function(req, res){
  var bucket = "jere-video-test"; // Detemine bucket in COS to look file from
  var filename = req.params.filename;
  cos.getSignedUrl("getObject", {Bucket: bucket, Key: filename, Expires: 60}, function(err, url){
    if(err){
      console.log(err);
      res.status(500);
      res.send(err);
    }
    else{
      console.log("Url is: " + url);
      res.status(200);
      res.send(url);
    }
  });
});

router.get("/2/video/:filename", function(req, res){
  var ua = req.headers["user-agent"];
  var isUnsafe = false; // If this is true, browser and/or server is probably having problems using Range header
  if(ua && ua.toLowerCase().includes("firefox")) isUnsafe = true; // Firefox seemed problematic
  else if(!ua) isUnsafe = true;
  var bucket = "jere-video-test"; // Detemine bucket in COS to look file from
  var filename = req.params.filename;
  var rangeHeader = req.headers.range;
  if(rangeHeader) {
    console.log("Range header present: " + rangeHeader);
    var range = rangeHeader.split("bytes=")[1]; // Get requested range, if Range header present
  }
  else { // Range header not present, get whole range and set unsafe
    console.log("Range header not present");
    var range = "0-";
    isUnsafe = true;
  }
  console.log("Unsafe verdict: is unsafe: " + isUnsafe);
  var rangeStart = range.split("-")[0];
  rangeStart = Number(rangeStart);
  var rangeEnd = range.split("-")[1];
  if(!rangeEnd || rangeEnd === "") {
    if(!isUnsafe) {
      rangeEnd = rangeStart + (1024 * 2000); // If browser assumeably behaves, give only partial document
    }
  }
  if(rangeEnd) rangeEnd = Number(rangeEnd);
  if(rangeEnd > (rangeStart + (1024 * 2000))) rangeEnd = rangeStart + (1024 * 2000);
  getChunk(bucket, filename, rangeStart, rangeEnd, isUnsafe, res);
});

function getChunk(bucket, filename, start, end, isUnsafe, res){
  cos.headObject({ Bucket: bucket, Key: filename}, function(err, data){ // Get metadata of given file (namely content length)
    if(err) {
      res.status(500);
      res.send(err);
    }
    else {
      var contentLength = data.ContentLength; // Total length of content
      // Checks that range values are within content length, would need more proper checks.
      // In reality, if range is not proper (end lower than start, end bigger than content length), should return 416
      if(start > contentLength) start = contentLength;
      if(!end || end === "" || end > contentLength) end = contentLength - 1;
      var range = "bytes=" + start + "-" + end;
      console.log(range);
      console.log("Getting from COS");
      var now = Date.now(); // For checking how long it takes
      cos.getObject({
        Bucket: bucket,
        Key: filename,
        ResponseContentType: "video/mp4", // Careful with this, should always match the actual one. They are stored as octet-streams in COS
        Range: range
      }, function(err, data){
        if(err){
          res.status(500);
          res.send(err);
        }
        else {
          console.log("Got from COS, took: " + (Date.now() - now) + "ms");
          var contentType = data.ContentType;
          var length = data.ContentLength;
          res.set("Accept-Ranges", "bytes");
          res.set("Content-Type", contentType);
          res.set("Content-Length", length);
          if(!isUnsafe) res.set("Content-Range", "bytes " + start + "-" + end + "/" + contentLength);
          res.set("Cache-Control", "no-cache");
          if(!isUnsafe) res.status(206); // If browser behaves, let it know this is only partial
          else res.status(200); // IF browser doesn't behave, just tell it here's everything
          res.send(data.Body);
        }
      });
    }
  });
}

app.use(router);

app.listen(8080, function(){
  console.log("Server starting on port 8080");
});
