"use strict";

function Game(params) {

  // create bound functions for callbacks, that refernce the 'this' object
  this.boundrender = this.render.bind(this);
  this.boundupdate = this.update.bind(this);

  // these define the frames per second both for rendering and updating
  this.updateDelay = 25; /* ~40 updates per second */
  this.renderDelay = 16; /* ~60 fps */

  // target drawing area
  this.canvas = params.canvas;

  // Total drawable entities
  this.entities = [];

  // Subgroups of entities, included in [entities]
  this.usercontrolled = [];

  // world dimensions (in world units)
  // - recalculated after loading maps
  this.map_width = 400 / SCALE;
  this.map_height = 400 / SCALE;

  // world viewport dimensions (in world units)
  // (!) these are recalculated every frame
  this.minimum_world_y = 0;
  this.minimum_world_x = 0;
  this.maximum_world_y = 300;
  this.maximum_world_x = 300;

  // for drag and drop, touch, selection etc
  this.mouseX = undefined;
  this.mouseY = undefined;
  this.mousePVec = undefined;
  this.isMouseDown = undefined;
  this.selectedEntity = undefined;
  this.controllingEntity = 0; // selected entity if it's one of the user controlled ones
  
  // ground layer, not included in [entities]
  // this.ground_tiles = [];
  this.tile_sizex_px = 32;
  this.tile_sizey_px = 32;
  this.tile_sizex_world = 32/SCALE;
  this.tile_sizey_world = 32/SCALE;

  // possible actions
  this.ACTION_PULL = 'pull';
  this.ACTION_BOMB = 'bomb';
  this.action = this.ACTION_PULL;

  // all the following will most probably be replaced at some point...
  this.last_created_in = -1; // used for creating elements at a pace

  // Pause world update
  this.pause = false;

  // Toggle debug view of underlying physics engine objects
  this.displayDebugInfo = false;

  // ground layers
  this.layers = [];
  // this.layers.push( this.ground_tiles );

  // reference to the drawing context
  this.ctx = this.canvas.getContext("2d");

  // mozilla - disable smooth resampling, just in case
  this.ctx.mozImageSmoothingEnabled=false;

  // physical world
  this.myworld = undefined;

}

Game.prototype.getSprite = function(name) {
  return definitions.reverse[name];
}


// --------------------------------------------------------------------------------------------
// Create world and shapes
// --------------------------------------------------------------------------------------------

Game.prototype.init = function() {

  // load map data (exported as JSON from Tiled)
  $.getJSON("maps/screen00.json", (function(data) {
    this.mapdata = data;
    this.init_phase_two(); // can't continue until this finishes
  }).bind(this));

}

// ----------------------------------------------------------------------------------------------
// ---------- INIT (continued after map loading) -----
// ----------------------------------------------------------------------------------------------

Game.prototype.init_phase_two = function() {

  // new world!
  this.map_width = this.mapdata.width*this.mapdata.tilewidth / SCALE;
  this.map_height = this.mapdata.height*this.mapdata.tileheight / SCALE;

  // Add entries in spritedefinitions for all the map data

  for(var tilesetid in this.mapdata.tilesets) {
    var tileset = this.mapdata.tilesets[tilesetid];

    var id = tileset.firstgid;
    var imgname = tileset.image;
    var rows = tileset.imageheight/tileset.tileheight;
    var cols = tileset.imagewidth/tileset.tilewidth;
    // currently ignoring: name, margin, spacing, and creating empty images
    var defs = [];
    for(var i=0; i<rows; i++) {
      for(var j=0; j<cols; j++) {

        // PSEUDO-EXTENSION to Tiled. Properties per TILESET that define margins inside the actual tilesize for the underlying physical object
        var def = {};
        def.id = id+"";
        def.x = j * tileset.tilewidth;
        def.y = i * tileset.tileheight;
        def.w = tileset.tilewidth;
        def.h = tileset.tileheight;
        def.top = tileset.properties.top ? tileset.properties.top : 0;
        def.right = tileset.properties.right ? tileset.properties.right : 0;
        def.bottom = tileset.properties.bottom ? tileset.properties.bottom : 0;
        def.left = tileset.properties.left ? tileset.properties.left : 0;
        def.bodyless = tileset.properties.bodyless ? true : false;

        defs.push(def);
        id = id + 1;
      }
    }
    // we need to parse the imgname and remove the leading '../'
    imgname = imgname.substr(3);
    definitions[imgname] = defs;  // create an entry in our own format for sprite definitions, which includes margins
  }


  // preload images
  for(var d in definitions) { // for each file, load the image it points to
    var lista = definitions[d];
    lista.cachedfile = new Image();
    lista.cachedfile.src = d;
  } 

  // preload sounds
  for(var s in sounds) { // for each file
    sounds[s].cachedfile = new Audio(sounds[s].src);
    sounds[s].cachedfile.load();
  } 

  // create structure to make lookup of a sprite definition by id faster
  definitions.reverse = [];
  for(var files in definitions) { // for each file, iterate through items
    var lista = definitions[files];
    for(var sd in lista) {
      definitions.reverse[lista[sd].id] = { sprite: lista[sd], image: lista.cachedfile }; 
    }
  } 

  // register keyboard and mouse listeners
  this.registerListeners();

  // Create a world that has no gravity, to simulate a top view
  this.myworld = new World();
  // choose implementation
  this.myworld.useBox2D()
  // this.myworld.useChipmunk();
  // do it...
  this.myworld.createworld({ gravity:{x:0,y:0} });

  // create objects
  for(var layerid in this.mapdata.layers) {
    var layer = this.mapdata.layers[layerid];

    // OBJECT layers

    if( layer.type == 'objectgroup') {
      for(var objid in layer.objects) {
        var obj = layer.objects[objid];

        // An object with a gid is a reference to a TILE

        if( obj.gid ) {

          // coordinates in TMX are of the (bottom,left) corner
          // whilst we want (top,left)

          var r = this.getSprite(obj.gid);

          var e = new Sprite( {
            id: this.entities.length,
            x: obj.x/SCALE,
            y: obj.y/SCALE - r.sprite.h/SCALE,
            imageid: obj.gid+"",
            bodyless:false,
            isstatic:false, // TODO: true
            angle:0,
            'game': this,
          } );
          this.entities.push( e );
        }

        // A POLYGON doesn't have an image, it's a static body, for defining areas that can't be traversed

        else if( obj.polygon ) {
          // it's a polygon object, used for defined boundaries not associated to sprites/tiles
          var points = obj.polygon;
          for(var p=0; p<points.length; p++) {
            points[p].x /= SCALE;
            points[p].y /= SCALE;
          }
          this.entities.push( new PolygonEntity(
            { id:this.entities.length, x:obj.x/SCALE, y:obj.y/SCALE, center:{x:null, y:null}, points:points, bodyless:false, isstatic:true } ) );
        }

      } // for
    }
    else if( layer.type == 'tilelayer' ) {

      // layer.data is just an array of 'gids'
      layer.tile_sizey = this.mapdata.tileheight;
      layer.tile_sizex = this.mapdata.tilewidth;
      this.layers.push(layer);

    }


  }

  // {x, y, w, h, isstatic, angle, ref}
  //create margins

  var bottom = new RectangleEntity({x:0, y:this.map_height, width:this.map_width, height:1/SCALE, isstatic:true});
  var top = new RectangleEntity({x:0, y:0, width:this.map_width, height:1/SCALE, isstatic:true});
  var left = new RectangleEntity({x:0, y:0, width:1/SCALE, height:this.map_height, isstatic:true});
  var right = new RectangleEntity({x:this.map_width, y:0, width:1/SCALE, height:this.map_height, isstatic:true});
  bottom.createbody(this.myworld);
  top.createbody(this.myworld);
  left.createbody(this.myworld);
  right.createbody(this.myworld);

  // initialize user controlled character
  var boy=new AnimatedSprite(
    { 'id': this.entities.length,
      'x': this.map_width*0.7,
      'y': 9.5,
      'speed': 3,
      'spritesleft': [ 'boy-left-01', 'boy-left-02' ],
      'spritesdownleft': [ 'boy-down-left-01', 'boy-down-left-02' ],
      'spritesupleft': [ 'boy-up-left-01', 'boy-up-left-02' ],
      'spritesright': [ 'boy-right-01', 'boy-right-02' ],
      'spritesupright': [ 'boy-up-right-01', 'boy-up-right-02' ],
      'spritesdownright': [ 'boy-down-right-01', 'boy-down-right-02' ],
      'spritesup': [ 'boy-up-01', 'boy-up-02' ],
      'spritesdown': [ 'boy-down-01', 'boy-down-02' ],
      'game': this,
    });
  this.entities.push( boy );
  this.usercontrolled.push( boy );

  //initialize car
  var car=new Car({'width':1,
                  'height':1.5,
                  'x': this.map_width*0.7,
                  'y': 3,
                  'angle':Math.PI, 
                  'power':60,
                  'max_steer_angle':30,
                  'max_speed':60,
                  'game': this,
                  'wheels':[{'x':-0.5, 'y':-0.5, 'width':0.3, 'height':0.4, 'revolving':true, 'powered':true}, //top left
                              {'x':0.5, 'y':-0.5, 'width':0.3, 'height':0.4, 'revolving':true, 'powered':true}, //top right
                              {'x':-0.5, 'y':0.5, 'width':0.3, 'height':0.4, 'revolving':false, 'powered':false}, //back left
                              {'x':0.5, 'y':0.5, 'width':0.3, 'height':0.4, 'revolving':false, 'powered':false}]}); //back right
  this.entities.push( car );
  this.usercontrolled.push( car );
  

  // goal posts
  var goalflaganim = [ 'lostgarden-flag-01', 'lostgarden-flag-02', 'lostgarden-flag-03', 'lostgarden-flag-04', 'lostgarden-flag-05', 'lostgarden-flag-06', 'lostgarden-flag-07', 'lostgarden-flag-08' ];
  var goalflag=new AnimatedSprite(
      { 'id': this.entities.length,
        'x': 0.5*this.map_width,
        'y': this.map_height-24/SCALE,
        'weight': 1000,
        'isstatic': true,
        'spritesstanding': goalflaganim,
        'spritesleft': goalflaganim,
        'spritesright': goalflaganim,
        'spritesup': goalflaganim,
        'spritesdown': goalflaganim,
        'game': this,
      });
  this.entities.push(goalflag);


  // now, for every entity, create a world body and add it to the world, with corresponding fixture
  for(var i in this.entities) {
      this.entities[i].createbody(this.myworld);
  }


  //setup debug draw
  this.myworld.setdebug( {canvas:this.canvas} );

  //setTimeout(init, 6000); <-- was in the original example, no idea why...

  this.controllingEntity = 0;

  // launch renderers

  // model update callback
  requestAnimFrame(this.boundrender); //, this.renderDelay);

  // render callback
  setTimeout(this.boundupdate, this.updateDelay);

}

// ----------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------

Game.prototype.registerListeners = function() {
  // register mouse and keyboard listeners

  // $(document).mousemove( (function(e) {
  //   if(e.originalEvent.touches && e.originalEvent.touches.length) {
  //     e = e.originalEvent.touches[0];
  //   } else if(e.originalEvent.changedTouches && e.originalEvent.changedTouches.length) {
  //     e = e.originalEvent.changedTouches[0];
  //   }
  //   var canvasPosition = this.getElementPosition(this.canvas);

  //   // remember current mouse position
  //   this.mouseX = (e.clientX - canvasPosition.x);
  //   this.mouseY = (e.clientY - canvasPosition.y);
  // }).bind(this) );
  this.canvas.onmousemove = (function(e) {
    // remember current mouse position
    var canvasPosition = this.getElementPosition(this.canvas);
    this.mouseX = (e.clientX - canvasPosition.x);
    this.mouseY = (e.clientY - canvasPosition.y);
  }).bind(this);

  $(document).mousedown( (function(e) {
    this.isMouseDown = true;
    return false;
  }).bind(this) );

  $(document).mouseup( (function(e) {
    this.isMouseDown = false;
    // this.mouseX = undefined;
    // this.mouseY = undefined;
  }).bind(this) );

  // equivalent touch listeners
  this.canvas.ontouchstart = (function(e) {
    //this.isMouseDown = true;

    // if( e.preventDefault ) e.preventDefault();
    if( e.originalEvent ) {
      e = e.originalEvent;
    }

    if( e.touches && e.touches.length) {
      e = e.touches[0];
    } else if( e.changedTouches && e.changedTouches.length) {
      e = e.changedTouches[0];
    }

    // remember current mouse position
    var canvasPosition = this.getElementPosition(this.canvas);
    this.mouseX = (e.clientX - canvasPosition.x);
    this.mouseY = (e.clientY - canvasPosition.y);
    return false; // swallow event if it touches an entity TODO: "if!!"
  }).bind(this);

  this.canvas.ontouchmove = (function(e) {
    // if( e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length ) {
    //   e = e.originalEvent.touches[0];
    // } else if( e.originalEvent && e.originalEvent.changedTouches && e.originalEvent.changedTouches.length ) {
    //   e = e.originalEvent.changedTouches[0];
    // }
    // // remember current mouse position
    // var canvasPosition = this.getElementPosition(this.canvas);
    // this.mouseX = (e.clientX - canvasPosition.x);
    // this.mouseY = (e.clientY - canvasPosition.y);
  }).bind(this);


  this.canvas.ontouchend = (function(e) {

    // if( e.preventDefault ) e.preventDefault();
    // this.isMouseDown = false;
    // this.mouseX = undefined;
    // this.mouseY = undefined;
    // return false;
  }).bind(this);

  this.canvas.ontouchcancel = (function(e) {
    // this.isMouseDown = false;
    // this.mouseX = undefined;
    // this.mouseY = undefined;
    // return false;
  }).bind(this);


  $(document).bind("mousewheel", (function(e) {
    // cope with browser diferences in the way wheel delta is returned
    e = window.event;

    var wheelDelta = e.detail ? e.detail * -1 : e.wheelDelta / 40;

    var wheelDeltaX = 0;
    if( e.detail.wheelDeltaX ) wheelDeltaX = e.detail.wheelDeltaX * -1;
    else if( e.wheelDeltaX ) wheelDeltaX = e.wheelDeltaX / 40;

    var wheelDeltaY = 0;
    if( e.detail.wheelDeltaY ) wheelDeltaY = e.detail.wheelDeltaY * -1;
    else if( e.wheelDeltaY ) wheelDeltaY = e.wheelDeltaY / 40;

    statustext.innerHTML = "wheel " + wheelDeltaX + "/" + wheelDeltaY;

  }).bind(this));


  // register keypresses
  $(document).keydown((function(e){
    switch(e.keyCode) {
      case 37: /* left */
        this.usercontrolled[this.controllingEntity].movement |= MOVE_LEFT;
        return false;
      case 38: /* up */
        this.usercontrolled[this.controllingEntity].movement |= MOVE_UP;
        return false;
      case 39: /* right */
        this.usercontrolled[this.controllingEntity].movement |= MOVE_RIGHT;
        return false;
      case 40: /* down */
        this.usercontrolled[this.controllingEntity].movement |= MOVE_DOWN;
        return false;
    }
    return true;
  }).bind(this));     // bind everything to the Game instance

  $(document).keyup((function(e){
    switch(e.keyCode) {
      case 37: /* left */
        this.usercontrolled[this.controllingEntity].movement &= ~MOVE_LEFT;
        return false;
      case 38: /* up */
        this.usercontrolled[this.controllingEntity].movement &= ~MOVE_UP;
        return false;
      case 39: /* right */
        this.usercontrolled[this.controllingEntity].movement &= ~MOVE_RIGHT;
        return false;
      case 40: /* down */
        this.usercontrolled[this.controllingEntity].movement &= ~MOVE_DOWN;
        return false;
      case 32: /* space */
        this.toggleAction();
        return false;
    }
    return true;
  }).bind(this));


}

// ----------------------------------------------------------------------------------------
//
// World update callback
//
// ----------------------------------------------------------------------------------------


Game.prototype.update = function() {

  // Calculate time elapsed since las update
  //
  var fps;
  var animStart=new Date().getTime();
  var elapsedMs = 1; // some default values so that 1st iteration doesn't crash
  if( typeof this.previousUpdateTime !== 'undefined') {
    elapsedMs = animStart-this.previousUpdateTime;
    if(elapsedMs!=0) fps = (1000/elapsedMs); // average
  }
  this.previousUpdateTime = animStart;

  if( !this.pause ) {

    // Execute physics engine
    //
    this.myworld.step( elapsedMs );

    // process user interactions
    //
   if(this.isMouseDown) {
      if(!this.myworld.isjoinedtomouse()) {
        if( this.action == this.ACTION_PULL ) {
           var foundbody = this.getBodyAtMouse();
           if(foundbody) {
              this.myworld.jointomouse( {x: this.mouseX/SCALE + this.minimum_world_x, y:this.mouseY/SCALE + this.minimum_world_y, body: foundbody });
            }
         } else if( this.action == this.ACTION_BOMB ) {
            // initialize bomb
            var bombanim = [ 'lostgarden-flame-01', 'lostgarden-flame-02', 'lostgarden-flame-03', 'lostgarden-flame-04', 'lostgarden-flame-05' ];
            var bomb=new AnimatedSprite(
              { 'id': this.entities.length,
                'x': this.mouseX/SCALE + this.minimum_world_x,
                'y': this.mouseY/SCALE + this.minimum_world_y,
                'speed': 0.5,
                'isstatic': true,
                'spritesstanding': bombanim,
                'spritesleft': bombanim,
                'spritesright': bombanim,
                'spritesup': bombanim,
                'spritesdown': bombanim,
                'game': this,
              });
            bomb.movement = MOVE_NONE;
            bomb.createbody(this.myworld);
            this.entities.push( bomb );
         }
       }
    }

    if( this.myworld.isjoinedtomouse() ) {
       if(this.isMouseDown) {
          var pos = {x: this.mouseX/SCALE + this.minimum_world_x, y: this.mouseY/SCALE + this.minimum_world_y};
          this.myworld.movejoinedmouse( pos );
       } else {
          this.myworld.unjoinfrommouse();
       }
    }

    // Remove forces applie so far, otherwise they pile up
    //
    this.myworld.clearforces();

    // Copy changes occured in the physics engine to the drawing this.entities
    // and execute AI if they have any
    //
    for(var e in this.entities) {
    	this.entities[e].update(elapsedMs, this.myworld);
    }

  } // if not pause
  
  // request next update
  setTimeout( this.boundupdate, this.updateDelay );
}; // update()


// ----------------------------------------------------------------------------------------------
// Helpers for pulling of an object
// ----------------------------------------------------------------------------------------------

Game.prototype.getBodyAtMouse = function() {

  var selected = this.myworld.bodyatmouse( {x:this.mouseX/SCALE + this.minimum_world_x, y: this.mouseY/SCALE + this.minimum_world_y } );

  if( selected ) {
    // if it's one of the user-controlled this.entities, switch to it
    var ref = this.myworld.getreffrombody(selected);
    if( ref ) {
      this.selectedEntity = ref;
      for(var e in this.usercontrolled ) {
        if( this.usercontrolled[e] == this.selectedEntity ) {
          this.controllingEntity = e;
        }
      }
    }
  }

  return selected;
}



// ----------------------------------------------------------------------------------------
//
// Rendering callback
//
// ----------------------------------------------------------------------------------------

Game.prototype.render = function() {

  // Calculate time since las frame was rendered
  //
  var animStart=new Date().getTime();
  var elapsedMs = 1; // some default values so that 1st iteration doesn't crash
  var fps = 1;
  if( typeof this.previousRenderTime !== 'undefined') {
    elapsedMs = animStart-this.previousRenderTime;
    if(elapsedMs!=0) fps = (1000/elapsedMs); // average
  }
  this.previousRenderTime = animStart;

  // Adjust canvas size if window size has changed
  //
  var neww = window.innerWidth;
  var newh = window.innerHeight- $('#game').position().top-2;
  var newcanvaswidth  = Math.floor(neww <= this.map_width*SCALE ? neww : this.map_width*SCALE);
  var newcanvasheight = Math.floor(newh <= this.map_height*SCALE ? newh : this.map_height*SCALE);

  if( this.canvas.width != newcanvaswidth || this.canvas.height != newcanvasheight ) {
    // assigning a value the canvas clears it, which is expensive, only do it if it's changed
    this.canvas.width = newcanvaswidth;
    this.canvas.height = newcanvasheight;
  }


  // Set scroll position to follow mouse
  //
  if( this.mouseY < 64 ) {
    this.minimum_world_y = Math.min(
                  Math.max(0, this.minimum_world_y - 10/SCALE ),
                  this.map_height - this.canvas.height/SCALE );   
  }
  if( this.mouseY > (this.canvas.height-64) ) {
    this.minimum_world_y = Math.min(
                  Math.max(0, this.minimum_world_y + 10/SCALE ),
                  this.map_height - this.canvas.height/SCALE );   
  }

  if( this.mouseX < 64 ) {
    this.minimum_world_x = Math.min(
                  Math.max(0, this.minimum_world_x - 10/SCALE ),
                  this.map_width - this.canvas.width/SCALE );   
  }
  if( this.mouseX > (this.canvas.width-64) ) {
    this.minimum_world_x = Math.min(
                  Math.max(0, this.minimum_world_x + 10/SCALE ),
                this.map_width - this.canvas.width/SCALE );
  }

  this.maximum_world_y = this.minimum_world_y + this.canvas.height/SCALE;
  this.maximum_world_x = this.minimum_world_x + this.canvas.width/SCALE;


  // When debugging, we don't draw tiles so clear the background
  //
  if( this.displayDebugInfo ) {
     this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
  }

  this.ctx.save();

  // Scroll world
  //
  this.ctx.translate(-Math.floor(this.minimum_world_x*SCALE), -Math.floor(this.minimum_world_y*SCALE) );

  // we actually paint some areas that are outside of the viewport because sprites are bigger than their physical bodies
  //
  var MARGIN_HORIZ = 60/SCALE;
  var MARGIN_VERT = 120/SCALE;

  // draw background tiles ("ground" layer)
  //
  if( !this.displayDebugInfo ) {
    for(var layerid in this.layers) {
      var layer = this.layers[layerid];
      var initialrow = Math.max( 0, Math.floor((this.minimum_world_y-MARGIN_VERT)/layer.tile_sizey/SCALE) );
      var lastrow = Math.min( layer.height-1, Math.floor((this.maximum_world_y+MARGIN_VERT)/(layer.tile_sizey/SCALE))+1 );
      var initialcol = Math.max( 0, Math.floor((this.minimum_world_x-MARGIN_HORIZ)/layer.tile_sizex/SCALE) );
      var lastcol = Math.min( layer.width-1, Math.floor((this.maximum_world_x+MARGIN_HORIZ)/(layer.tile_sizex/SCALE))+1 );
      var i, j, gid, r;
      for(i=initialrow; i<=lastrow; i++) {
        for(j=initialcol; j<=lastcol; j++) {
          gid = layer.data[i*layer.width + j];
          r = this.getSprite(gid);
          this.ctx.drawImage( r.image, r.sprite.x, r.sprite.y, r.sprite.w, r.sprite.h, j*layer.tile_sizex, i*layer.tile_sizey, r.sprite.w, r.sprite.h );
        }
      }
    }
  }

  // Find all elements that are visible
  // 
  // find all entities that are visible, based on their physical bodies' location
  var visible = this.myworld.bodiesatrect({x:this.minimum_world_x-MARGIN_HORIZ, 
                                           y:this.minimum_world_y-MARGIN_VERT,
                                           width:this.maximum_world_x+MARGIN_HORIZ,
                                           height:this.maximum_world_y+MARGIN_VERT,
                                           selectstatics: true,
                                           returnrefs: true});

  // TODO: move this to separate array... or something
  // add the 'bodyless' sprites as they will have not appeared in the above query
  //
  for(var i in this.entities) {
    var entity = this.entities[i];
    if( entity.bodyless ) {
      visible.push(entity);
    }
  }

  // sort elements based on y coordinate, to make elements below appear on top of previous, to get Zelda-like fake perspective
  // TODO: utilizar un arbol o algo que ya esté ordenado durante la insercion
  //
  visible.sort((function(a,b) {

    var bb1_y = a.y - a.height/2;
    var bb2_y = b.y - b.height/2;
    if( a.body ) {
      var bb = this.myworld.getboundingbox(a.body);
      bb1_y = bb.y0;
    }
    if( b.body ) {
      var bb = this.myworld.getboundingbox(b.body);
      bb2_y = bb.y0;
    }


    var val1 = bb1_y - bb2_y;
    if( val1 < 0 ) return -1;
    else if( val1 > 0 ) return 1;

    var bb1_x = a.x - a.width/2;
    var bb2_x = b.x - b.width/2;
    if( a.body ) {
      var bb = this.myworld.getboundingbox(a.body);
      bb1_x = bb.x0;
    }
    if( b.body ) {
      var bb = this.myworld.getboundingbox(b.body);
      bb2_x = bb.x0;
    }

    var val2 = bb1_x - bb2_x;
    if( val2 < 0 ) return -1;
    else if( val2 > 0 ) return 1;

    return 0; // equal
  }).bind(this));


  // Finally, draw all those entities, in order
  //
  var parametros = { ctx: this.ctx, isSelected: false };
  for(var i in visible) {
    entity = visible[i];
    parametros.isSelected = (this.selectedEntity == entity);
    if( !this.displayDebugInfo ) entity.draw(parametros);
  }

  // draw user interactions
  //
  if( this.myworld.isjoinedtomouse() ) {
      this.ctx.beginPath();
      var v = this.myworld.getjoinmousepos_origin();
      this.ctx.moveTo(v.x*SCALE, v.y*SCALE);
      this.ctx.strokeStyle = 'yellow';
      this.ctx.lineWidth = 2;
      this.ctx.lineCap = 'round';
      this.ctx.miterLimit = 4;
      this.ctx.lineTo(this.mouseX + this.minimum_world_x*SCALE, this.mouseY + this.minimum_world_y*SCALE);
      this.ctx.closePath();
      this.ctx.stroke();
  }

  // debug info, fps
  if( this.displayDebugInfo ) {
    this.myworld.world.DrawDebugData();
  }

  // draw stats and other info
  //
  this.ctx.restore();
  this.ctx.fillStyle = '#EEEEEE';
  this.ctx.fillRect(25,38,44,-22);
  this.ctx.fillRect(25,52,64,-10);
  this.ctx.fillRect(25,64,64,-10);
  this.ctx.fillStyle = 'black';
  this.ctx.fillText('FPs: '+parseInt(fps), 25, 25);
  this.ctx.fillText(this.entities.length, 25, 35);
  this.ctx.fillText(this.action, 26, 62);
  if( this.mouseX && this.mouseY ) {
    this.ctx.fillText(this.mouseX.toFixed(2) + "-" + this.mouseY.toFixed(2), 25, 50);
  }

  // request next render
  requestAnimFrame(this.boundrender);
}


//http://js-tut.aardon.de/js-tut/tutorial/position.html
Game.prototype.getElementPosition = function(element) {
  var elem=element, tagname="", x=0, y=0;
 
  while((typeof(elem) == "object") && (typeof(elem.tagName) != "undefined")) {
     y += elem.offsetTop;
     x += elem.offsetLeft;
     tagname = elem.tagName.toUpperCase();

     if(tagname == "BODY")
        elem=0;

     if(typeof(elem) == "object") {
        if(typeof(elem.offsetParent) == "object")
           elem = elem.offsetParent;
     }
  }

  return {x: x, y: y};
}



// -------------------------------------------------------------------------------

Game.prototype.toggleSelected = function() {

  this.usercontrolled[this.controllingEntity].movement = MOVE_NONE;
  this.controllingEntity = (this.controllingEntity+1)%this.usercontrolled.length;
}


Game.prototype.toggleAction = function() {
  if( this.action === this.ACTION_PULL ) this.action = this.ACTION_BOMB;
  else this.action = this.ACTION_PULL;
}

Game.prototype.togglePause = function() {
  this.pause = !this.pause;
}

// -------------------------------------------------------------------------------

Game.prototype.toggledebug = function() {
  if(this.displayDebugInfo) this.displayDebugInfo = false;
  else this.displayDebugInfo = true;
}

