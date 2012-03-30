// -------------------------------------------------------------------------------
"use strict";
// -------------------------------------------------------------------------------------------------------
// Circle is an entity in the world that has a circular shape. Update does nothing. Intended for extension.
// params:
//    id - unique entity identifier
//    x, y - position in world (center)
//    radius - circle radius
//    angle - rotation angle of the image - for most uses you don't want rotation
//    bodyless - whether this Sprite has a physical object associated to it
//    isstatic - whether that associated physycal object is defined as static in the world (doesn't move).
// -------------------------------------------------------------------------------------------------------
// id, x, y, center, radius
function CircleEntity( params ) {
  Entity.call(this, params);
  this.radius = radius;
}

CircleEntity.prototype = new Entity();

CircleEntity.prototype.constructor = CircleEntity;
    
CircleEntity.prototype.draw = function(params) {

  // not actually drawing anything
  Entity.prototype.draw.call(this, params);
}

// create a corresponding Box2D body and fixture for this entity
CircleEntity.prototype.createbody = function(world) {

  if( this.bodyless ) {
    return; // this type of entity doesn't have associated phsyical object
  }

  // safety check
  if( isNaN(this.radius) || isNaN(this.x) || isNaN(this.y) ) {
    console.log("Circle: Attempt to create body with invalid definition.");
    return;
  }

  var fixDef = new b2FixtureDef;
  fixDef.density = 1.0;
  fixDef.friction = 0.5;
  fixDef.restitution = 0.2;
  var bodyDef = new b2BodyDef;
  bodyDef.linearDamping = 16;  // -/these simulates floor friction, otherwise objects behave like in space
  bodyDef.angularDamping = 16; // /

  if( this.weight) {
    bodyDef.linearDamping += 16 + this.weight;
  }

  if( this.isstatic ) bodyDef.type = b2Body.b2_staticBody;
  else bodyDef.type = b2Body.b2_dynamicBody;

  fixDef.shape = new b2CircleShape(this.radius);

  bodyDef.position.x = this.x;
  bodyDef.position.y = this.y;
  bodyDef.userData = this;
  this.body = world.CreateBody(bodyDef);
  this.body.CreateFixture(fixDef);
}