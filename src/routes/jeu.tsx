import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
export const Route = createFileRoute("/jeu")({
  head: () => ({
    meta: [
      { title: "Super Hopper — Petit jeu" },
      { name: "description", content: "Un petit jeu pour patienter pendant la vérification." },
    ],
  }),
  component: JeuPage,
});

/* Reference: "Procedural 3D Endless Runner Game" — Hola Soy Malva
   (codepen.io/holasoymalva/pen/XJKdqVj, via freefrontend.com). Game loop,
   physics constants, procedural generation and collision logic are ported
   verbatim; DOM wiring is adapted from the CodePen to this route. */

const CONFIG = {
  laneWidth: 2.5,
  cameraOffset: { x: 0, y: 7, z: 10 },
  gravity: 0.015,
  jumpPower: 0.35,
  baseSpeed: 0.2,
  speedInc: 0.0001,
  floorLength: 400,
  fogDensity: 0.02,
};

type Theme = { name: string; sky: number; ground: number; obstacle: number; decor: number };

const THEMES: Theme[] = [
  { name: "Lilac Candy", sky: 0xf3e8ff, ground: 0xfaf5ff, obstacle: 0xa855f7, decor: 0xd8b4fe },
  { name: "Neon Violet", sky: 0x18102b, ground: 0x241539, obstacle: 0xc084fc, decor: 0x4c1d95 },
  { name: "Violet Sunset", sky: 0xe9d5ff, ground: 0xc084fc, obstacle: 0x3b0764, decor: 0xa78bfa },
  { name: "Amethyst", sky: 0xede9fe, ground: 0xffffff, obstacle: 0x7c3aed, decor: 0x8b5cf6 },
  { name: "Dark Amethyst", sky: 0x0b0614, ground: 0x2a1b3d, obstacle: 0xf0abfc, decor: 0x581c87 },
];

type GameState = {
  isPlaying: boolean;
  score: number;
  speed: number;
  lane: number;
  currentLaneX: number;
  isJumping: boolean;
  jumpVel: number;
  playerY: number;
  theme: Theme | null;
};

function freshState(): GameState {
  return {
    isPlaying: false,
    score: 0,
    speed: CONFIG.baseSpeed,
    lane: 0,
    currentLaneX: 0,
    isJumping: false,
    jumpVel: 0,
    playerY: 0,
    theme: null,
  };
}

function JeuPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);

  const startGameRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(CONFIG.cameraOffset.x, CONFIG.cameraOffset.y, CONFIG.cameraOffset.z);
    camera.lookAt(0, 0, -5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    let state = freshState();
    let player: THREE.Group | null = null;
    let floorGroups: THREE.Object3D[] = [];
    let worldObjects: { mesh: THREE.Object3D; type: string; lane?: number }[] = [];
    let spawnTimer = 0;
    let rafId = 0;
    let disposed = false;

    // --- DOM refs into this page (the pen queried document globally) ---
    const elScore = document.getElementById("jeu-score");
    const elScoreFinal = document.getElementById("jeu-final-score");
    const uiScore = document.getElementById("jeu-score-display");
    const uiStart = document.getElementById("jeu-start-screen");
    const uiGameOver = document.getElementById("jeu-game-over-screen");

    function randomTheme() {
      return THEMES[Math.floor(Math.random() * THEMES.length)];
    }

    function createPlayer() {
      if (player) scene.remove(player);

      const group = new THREE.Group();

      const animalColors = [0xffffff, 0xaaaaaa, 0xffcc99, 0x333333];
      const color = animalColors[Math.floor(Math.random() * animalColors.length)]!;

      const mat = new THREE.MeshStandardMaterial({ color, flatShading: true });

      const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
      const body = new THREE.Mesh(bodyGeo, mat);
      body.position.y = 0.5;
      body.castShadow = true;
      group.add(body);

      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const eyeGeo = new THREE.BoxGeometry(0.15, 0.15, 0.05);

      const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
      leftEye.position.set(-0.25, 0.6, 0.5);
      group.add(leftEye);

      const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
      rightEye.position.set(0.25, 0.6, 0.5);
      group.add(rightEye);

      const earType = Math.floor(Math.random() * 3);
      const earGeo =
        earType === 0
          ? new THREE.BoxGeometry(0.2, 0.5, 0.2)
          : earType === 1
            ? new THREE.BoxGeometry(0.3, 0.3, 0.1)
            : new THREE.ConeGeometry(0.2, 0.4, 4);

      const leftEar = new THREE.Mesh(earGeo, mat);
      leftEar.position.set(-0.3, 1.1, 0);
      if (earType !== 2) leftEar.castShadow = true;
      group.add(leftEar);

      const rightEar = new THREE.Mesh(earGeo, mat);
      rightEar.position.set(0.3, 1.1, 0);
      if (earType !== 2) rightEar.castShadow = true;
      group.add(rightEar);

      scene.add(group);
      return group;
    }

    function createObstacleMesh() {
      const type = Math.floor(Math.random() * 3);
      const geo =
        type === 0
          ? new THREE.ConeGeometry(0.5, 1, 6)
          : type === 1
            ? new THREE.BoxGeometry(1, 1, 1)
            : new THREE.CylinderGeometry(0.5, 0.5, 1, 6);

      const mat = new THREE.MeshStandardMaterial({
        color: state.theme!.obstacle as number,
        flatShading: true,
        transparent: true,
        opacity: 0.75,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    function createDecorationMesh() {
      const group = new THREE.Group();
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, flatShading: true });
      const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 5);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.75;
      trunk.castShadow = true;
      group.add(trunk);

      const leavesMat = new THREE.MeshStandardMaterial({
        color: state.theme!.decor,
        flatShading: true,
        transparent: true,
        opacity: 0.8,
      });
      const leavesGeo = new THREE.DodecahedronGeometry(0.8);
      const leaves = new THREE.Mesh(leavesGeo, leavesMat);
      leaves.position.y = 1.8;
      leaves.castShadow = true;
      group.add(leaves);

      return group;
    }

    function spawnRow() {
      const zStart = -60;

      if (Math.random() > 0.3) {
        const dL = createDecorationMesh();
        dL.position.set(-5 - Math.random() * 5, 0, zStart);
        scene.add(dL);
        worldObjects.push({ mesh: dL, type: "decor" });
      }

      if (Math.random() > 0.3) {
        const dR = createDecorationMesh();
        dR.position.set(5 + Math.random() * 5, 0, zStart);
        scene.add(dR);
        worldObjects.push({ mesh: dR, type: "decor" });
      }

      if (Math.random() > 0.3) {
        const lane = Math.floor(Math.random() * 3) - 1;
        const obs = createObstacleMesh();
        obs.position.set(lane * CONFIG.laneWidth, 0.5, zStart);
        scene.add(obs);
        worldObjects.push({ mesh: obs, type: "obstacle", lane });
      }
    }

    function gameOver() {
      state.isPlaying = false;
      uiGameOver?.classList.remove("hidden");
      uiScore?.classList.add("hidden");
      if (elScoreFinal) elScoreFinal.innerText = String(Math.floor(state.score));
      setGameOver(true);
      setBest((b) => Math.max(b, Math.floor(state.score)));
    }

    function animate() {
      if (!state.isPlaying) return;

      requestAnimationFrame(animate);

      state.score += state.speed;
      state.speed += CONFIG.speedInc;
      if (elScore) elScore.innerText = String(Math.floor(state.score));

      if (player) {
        const targetX = state.lane * CONFIG.laneWidth;
        state.currentLaneX += (targetX - state.currentLaneX) * 0.15;
        player.position.x = state.currentLaneX;

        if (state.isJumping) {
          state.playerY += state.jumpVel;
          state.jumpVel -= CONFIG.gravity;
          if (state.playerY <= 0) {
            state.playerY = 0;
            state.isJumping = false;
          }
        } else {
          state.playerY = Math.abs(Math.sin(Date.now() * 0.015)) * 0.1;
        }
        player.position.y = state.playerY + 0.5;

        player.rotation.z = (state.currentLaneX - player.position.x) * -0.1;
        player.rotation.x = state.isJumping ? -0.2 : 0;
      }

      spawnTimer += state.speed;
      if (spawnTimer > 3) {
        spawnRow();
        spawnTimer = 0;
      }

      for (let i = worldObjects.length - 1; i >= 0; i--) {
        const obj = worldObjects[i]!;
        obj.mesh.position.z += state.speed * 2;

        if (obj.type === "obstacle" && player) {
          if (obj.mesh.position.z > -0.8 && obj.mesh.position.z < 0.8) {
            const dx = Math.abs(player.position.x - obj.mesh.position.x);
            const dy = Math.abs(player.position.y - obj.mesh.position.y);

            if (dx < 0.8 && dy < 0.8) {
              gameOver();
            }
          }
        }

        if (obj.mesh.position.z > 10) {
          scene.remove(obj.mesh);
          worldObjects.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
    }

    function startGame() {
      if (state.isPlaying) return;

      state = {
        isPlaying: true,
        score: 0,
        speed: CONFIG.baseSpeed,
        lane: 0,
        currentLaneX: 0,
        isJumping: false,
        jumpVel: 0,
        playerY: 0,
        theme: randomTheme() as Theme,
      };

      uiStart?.classList.add("hidden");
      uiGameOver?.classList.add("hidden");
      uiScore?.classList.remove("hidden");
      if (elScore) elScore.innerText = "0";

      scene.background = new THREE.Color(state.theme!.sky);
      scene.fog = new THREE.Fog(state.theme!.sky, 10, 50);

      floorGroups.forEach((f) => scene.remove(f));
      floorGroups = [];

      const planeGeo = new THREE.PlaneGeometry(100, 200);
      const planeMat = new THREE.MeshStandardMaterial({ color: state.theme!.ground, roughness: 1 });
      const floor = new THREE.Mesh(planeGeo, planeMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.z = -50;
      floor.receiveShadow = true;
      scene.add(floor);
      floorGroups.push(floor);

      const grid = new THREE.GridHelper(200, 100, 0xffffff, 0xffffff);
      grid.position.y = 0.01;
      grid.position.z = -50;
      (grid.material as THREE.Material).opacity = 0.1;
      (grid.material as THREE.Material).transparent = true;
      scene.add(grid);
      floorGroups.push(grid);

      player = createPlayer();
      player.position.set(0, 0, 0);

      worldObjects.forEach((obj) => scene.remove(obj.mesh));
      worldObjects = [];

      setStarted(true);
      setGameOver(false);
      animate();
    }

    function handleInput(e: KeyboardEvent) {
      if (!state.isPlaying) {
        if (e.code === "Space" || e.code === "Enter") startGame();
        return;
      }

      if (e.code === "ArrowLeft") {
        if (state.lane > -1) state.lane--;
      } else if (e.code === "ArrowRight") {
        if (state.lane < 1) state.lane++;
      } else if (e.code === "ArrowUp") {
        if (!state.isJumping) {
          state.isJumping = true;
          state.jumpVel = CONFIG.jumpPower;
        }
      }
    }

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener("resize", onWindowResize);
    document.addEventListener("keydown", handleInput);
    startGameRef.current = startGame;
    renderer.render(scene, camera);

    // --- Touch controls: swipe left/right = lane, swipe up = jump, tap = start ---
    let touchStartX = 0;
    let touchStartY = 0;
    let touchTracking = false;

    const SWIPE_MIN = 30; // px before a touch counts as a swipe

    function onTouchStart(e: TouchEvent) {
      const t = e.changedTouches[0];
      if (!t) return;
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      touchTracking = true;
    }

    function onTouchEnd(e: TouchEvent) {
      if (!touchTracking) return;
      touchTracking = false;
      const t = e.changedTouches[0];
      if (!t) return;

      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;

      // Tap (small movement) acts like Space/Enter — starts or restarts the game
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) {
        if (!state.isPlaying) startGame();
        return;
      }

      if (!state.isPlaying) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0 && state.lane < 1) state.lane++;
        else if (dx < 0 && state.lane > -1) state.lane--;
      } else if (dy < 0 && !state.isJumping) {
        state.isJumping = true;
        state.jumpVel = CONFIG.jumpPower;
      }
    }

    // Prevent the browser from scrolling/refreshing while swiping on the game
    function onTouchMove(e: TouchEvent) {
      if (state.isPlaying) e.preventDefault();
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onWindowResize);
      document.removeEventListener("keydown", handleInput);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchmove", onTouchMove);
      floorGroups.forEach((f) => scene.remove(f));
      worldObjects.forEach((obj) => scene.remove(obj.mesh));
      if (player) scene.remove(player);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      startGameRef.current = null;
    };
  }, []);

  function onStartClick() {
    startGameRef.current?.();
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {/* Game canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* UI layer — structure and styling ported from the pen's CSS */}
      <div className="pointer-events-none absolute inset-0 z-10 select-none font-mono">
        <a
          href="/"
          className="pointer-events-auto absolute top-5 left-5 rounded border-2 border-white/60 bg-black/30 px-3 py-1.5 text-xl text-white backdrop-blur-sm transition-colors hover:bg-black/50"
        >
          ← RETOUR
        </a>

        <div id="jeu-score-display" className="absolute top-5 left-5 hidden text-5xl text-white [text-shadow:2px_2px_#000]">
          SCORE: <span id="jeu-score">0</span>
        </div>

        <div className="absolute top-5 right-5 rounded-[10px] border-2 border-white/30 bg-white/10 p-4 text-right text-xl text-white backdrop-blur-sm">
          <span className="mr-1 inline-block rounded border-2 border-white bg-black/30 px-1.5 font-bold">←</span>
          <span className="mr-2 inline-block rounded border-2 border-white bg-black/30 px-1.5 font-bold">→</span> BOUGER
          <br />
          <span className="mr-2 inline-block rounded border-2 border-white bg-black/30 px-1.5 font-bold">↑</span> SAUTER
        </div>

        <div id="jeu-start-screen" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-4 border-white bg-black/40 px-16 py-8 text-center backdrop-blur-sm [box-shadow:0_10px_0_rgba(0,0,0,0.2)]">
          <h1 className="mb-2 text-7xl leading-none text-[#ffd700] [text-shadow:4px_4px_#ff6b6b]">SUPER HOPPER</h1>
          <p className="mb-8 text-3xl text-white uppercase">Petite pause vérification</p>
          <button
            onClick={onStartClick}
            className="pointer-events-auto cursor-pointer border-none bg-white px-8 py-4 font-mono text-3xl text-[#222] [box-shadow:0_6px_0_#999] transition-all hover:bg-[#f0f0f0] active:translate-y-[6px] active:[box-shadow:0_0_0_#999]"
          >
            {started ? "REJOUER" : "PRESS START"}
          </button>
          {best > 0 && <p className="mt-4 text-2xl text-white">MEILLEUR SCORE : {best}</p>}
        </div>

        <div id="jeu-game-over-screen" className="hidden absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-4 border-white bg-black/40 px-16 py-8 text-center backdrop-blur-sm [box-shadow:0_10px_0_rgba(0,0,0,0.2)]">
          <h1 className="mb-2 text-7xl leading-none text-[#ffd700] [text-shadow:4px_4px_#ff6b6b]">GAME OVER</h1>
          <p className="mb-8 text-3xl text-white uppercase">
            SCORE : <span id="jeu-final-score">0</span>
          </p>
          <button
            onClick={onStartClick}
            className="pointer-events-auto cursor-pointer border-none bg-white px-8 py-4 font-mono text-3xl text-[#222] [box-shadow:0_6px_0_#999] transition-all hover:bg-[#f0f0f0] active:translate-y-[6px] active:[box-shadow:0_0_0_#999]"
          >
            REESSAYER
          </button>
          {best > 0 && <p className="mt-4 text-2xl text-white">MEILLEUR SCORE : {best}</p>}
        </div>
      </div>
    </div>
  );
}
