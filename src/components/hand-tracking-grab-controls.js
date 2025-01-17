var registerComponent = require('../core/component').registerComponent;
var THREE = require('../lib/three');

registerComponent('hand-tracking-grab-controls', {
  schema: {
    hand: {default: 'right', oneOf: ['left', 'right']},
    color: {type: 'color', default: 'white'},
    hoverColor: {type: 'color', default: '#538df1'},
    hoverEnabled: {default: false}
  },

  init: function () {
    var el = this.el;
    var data = this.data;
    var trackedObject3DVariable;

    if (data.hand === 'right') {
      trackedObject3DVariable = 'components.hand-tracking-controls.bones.3';
    } else {
      trackedObject3DVariable = 'components.hand-tracking-controls.bones.21';
    }

    el.setAttribute('hand-tracking-controls', {hand: data.hand});
    el.setAttribute('obb-collider', {trackedObject3D: trackedObject3DVariable, size: 0.04});

    this.auxMatrix = new THREE.Matrix4();
    this.auxQuaternion = new THREE.Quaternion();
    this.auxQuaternion2 = new THREE.Quaternion();
    this.auxVector = new THREE.Vector3();
    this.auxVector2 = new THREE.Vector3();

    this.grabbingObjectPosition = new THREE.Vector3();
    this.grabbedObjectPosition = new THREE.Vector3();
    this.grabbedObjectPositionDelta = new THREE.Vector3();
    this.grabDeltaPosition = new THREE.Vector3();
    this.grabInitialRotation = new THREE.Quaternion();

    this.onCollisionStarted = this.onCollisionStarted.bind(this);
    this.el.addEventListener('obbcollisionstarted', this.onCollisionStarted);

    this.onCollisionEnded = this.onCollisionEnded.bind(this);
    this.el.addEventListener('obbcollisionended', this.onCollisionEnded);

    this.onPinchStarted = this.onPinchStarted.bind(this);
    this.el.addEventListener('pinchstarted', this.onPinchStarted);

    this.onPinchEnded = this.onPinchEnded.bind(this);
    this.el.addEventListener('pinchended', this.onPinchEnded);
  },

  transferEntityOwnership: function () {
    var grabbingElComponent;
    var grabbingEls = this.el.sceneEl.querySelectorAll('[hand-tracking-grab-controls]');
    for (var i = 0; i < grabbingEls.length; ++i) {
      grabbingElComponent = grabbingEls[i].components['hand-tracking-grab-controls'];
      if (grabbingElComponent === this) { continue; }
      if (this.collidedEl && this.collidedEl === grabbingElComponent.grabbedEl) {
        grabbingElComponent.releaseGrabbedEntity();
      }
    }
    return false;
  },

  onCollisionStarted: function (evt) {
    var withEl = evt.detail.withEl;
    if (this.collidedEl) { return; }
    if (!withEl.getAttribute('grabbable')) { return; }
    this.collidedEl = withEl;
    this.grabbingObject3D = evt.detail.trackedObject3D;
    if (this.data.hoverEnabled) {
      this.el.setAttribute('hand-tracking-controls', 'modelColor', this.data.hoverColor);
    }
  },

  onCollisionEnded: function () {
    if (this.grabbedEl) { return; }
    this.collidedEl = undefined;
    this.grabbingObject3D = undefined;
    if (this.data.hoverEnabled) {
      this.el.setAttribute('hand-tracking-controls', 'modelColor', this.data.color);
    }
  },

  onPinchStarted: function () {
    if (!this.collidedEl) { return; }
    this.transferEntityOwnership();
    this.grabbedEl = this.collidedEl;
    this.grab();
  },

  onPinchEnded: function () {
    this.releaseGrabbedEntity();
  },

  releaseGrabbedEntity: function () {
    var grabbedEl = this.grabbedEl;
    if (!grabbedEl) { return; }

    grabbedEl.object3D.updateMatrixWorld = this.originalUpdateMatrixWorld;
    grabbedEl.object3D.matrixAutoUpdate = true;
    grabbedEl.object3D.matrixWorldAutoUpdate = true;

    grabbedEl.object3D.matrixWorld.decompose(this.auxVector, this.auxQuaternion, this.auxVector2);
    grabbedEl.object3D.position.copy(this.auxVector);
    grabbedEl.object3D.quaternion.copy(this.auxQuaternion);

    this.grabbedEl = undefined;
  },

  grab: function () {
    var grabbingObject3D = this.grabbingObject3D;
    var grabbedEl = this.grabbedEl;
    var grabbingObjectWorldPosition;
    var grabedObjectWorldPosition;

    grabbingObjectWorldPosition = grabbingObject3D.getWorldPosition(this.grabbingObjectPosition);
    grabedObjectWorldPosition = grabbedEl.object3D.getWorldPosition(this.grabbedObjectPosition);

    this.grabDeltaPosition.copy(grabedObjectWorldPosition).sub(grabbingObjectWorldPosition);
    this.grabInitialRotation.copy(grabbingObject3D.getWorldQuaternion(this.auxQuaternion).invert());

    this.originalUpdateMatrixWorld = grabbedEl.object3D.updateMatrixWorld;
    grabbedEl.object3D.updateMatrixWorld = function () { /* no op */ };
    grabbedEl.object3D.updateMatrixWorldChildren = function (force) {
      var children = this.children;

      for (var i = 0, l = children.length; i < l; i++) {
        var child = children[i];

        if (child.matrixWorldAutoUpdate === true || force === true) {
          child.updateMatrixWorld(true);
        }
      }
    };
    grabbedEl.object3D.matrixAutoUpdate = false;
    grabbedEl.object3D.matrixWorldAutoUpdate = false;
  },

  tock: function () {
    var auxMatrix = this.auxMatrix;
    var auxVector = this.auxVector;
    var auxQuaternion = this.auxQuaternion;
    var auxQuaternion2 = this.auxQuaternion2;

    var grabbedObject3D;
    var grabbingObject3D = this.grabbingObject3D;
    var grabbedEl = this.grabbedEl;

    if (!grabbedEl) { return; }

    // We have to compose 4 transformations.
    // Both grabbing and grabbed entities position and rotation.

    // 1. Move grabbed  entity to grabbing entity position.
    // 2. Apply the rotation delta (substract initial rotation) of the grabbing entity position.
    // 3. Translate grabbed entity to the original position: distance betweeen grabbed and grabbing entities at collision time.
    // 4. Apply grabbed entity rotation.
    // 5. Preserve original scale.

    // Store grabbed entity local rotation.
    grabbedObject3D = grabbedEl.object3D;
    grabbedObject3D.getWorldQuaternion(auxQuaternion2);

    // Reset grabbed entity matrix.
    grabbedObject3D.matrixWorld.identity();

    // 1.
    auxMatrix.identity();
    auxMatrix.makeTranslation(grabbingObject3D.getWorldPosition(auxVector));
    grabbedObject3D.matrixWorld.multiply(auxMatrix);

    // 2.
    auxMatrix.identity();
    auxMatrix.makeRotationFromQuaternion(grabbingObject3D.getWorldQuaternion(auxQuaternion).multiply(this.grabInitialRotation));
    grabbedObject3D.matrixWorld.multiply(auxMatrix);

    // 3.
    auxMatrix.identity();
    auxMatrix.makeTranslation(this.grabDeltaPosition);
    grabbedObject3D.matrixWorld.multiply(auxMatrix);

    // 4.
    auxMatrix.identity();
    auxMatrix.makeRotationFromQuaternion(auxQuaternion2);
    grabbedObject3D.matrixWorld.multiply(auxMatrix);

    // 5.
    auxMatrix.makeScale(grabbedEl.object3D.scale.x, grabbedEl.object3D.scale.y, grabbedEl.object3D.scale.z);
    grabbedObject3D.matrixWorld.multiply(auxMatrix);

    grabbedObject3D.updateMatrixWorldChildren();
  }
});
