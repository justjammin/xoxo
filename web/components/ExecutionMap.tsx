import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import type { RunEvent } from "../lib/api";

type Node = { id: string; lane: "x" | "y" | "shared"; x: number; y: number; z: number };

function hash(value: string): number {
  let out = 2166136261;
  for (const char of value) out = Math.imul(out ^ char.charCodeAt(0), 16777619);
  return out >>> 0;
}

function Scene({ nodes }: { nodes: Node[] }) {
  const lineGeometry = useMemo(() => {
    const positions: number[] = [];
    for (let index = 1; index < nodes.length; index++) {
      const previous = nodes[index - 1];
      const node = nodes[index];
      if (!previous || !node) continue;
      positions.push(previous.x, previous.y, previous.z, node.x, node.y, node.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, [nodes]);

  return (
    <>
      <ambientLight intensity={1.8} />
      <directionalLight position={[3, 5, 4]} intensity={2.2} />
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial color="#8e877b" transparent opacity={0.45} />
      </lineSegments>
      {nodes.map((node, index) => (
        <mesh key={node.id} position={[node.x, node.y, node.z]}>
          <sphereGeometry args={[index === 0 ? 0.19 : 0.12, 16, 16]} />
          <meshStandardMaterial
            color={node.lane === "x" ? "#315a8a" : node.lane === "y" ? "#ad4938" : "#1d1b19"}
            roughness={0.62}
          />
        </mesh>
      ))}
    </>
  );
}

export function ExecutionMap({ runId, events }: { runId: string; events: RunEvent[] }) {
  const nodes = useMemo<Node[]>(() => {
    const source = events.slice(0, 249);
    return [{ id: runId, lane: "shared", x: 0, y: 0, z: 0 } as Node].concat(
      source.map((event, index) => {
        const seed = hash(`${runId}:${event.seq}:${event.kind}`);
        const lane = String(event.payload?.slot ?? event.payload?.candidate ?? "shared").toLowerCase();
        const normalizedLane: Node["lane"] = lane === "x" ? "x" : lane === "y" ? "y" : "shared";
        const angle = index * 0.73 + (seed % 97) / 97;
        const radius = 0.8 + Math.sqrt(index + 1) * 0.22;
        return {
          id: `${event.seq}-${event.kind}`,
          lane: normalizedLane,
          x: Math.cos(angle) * radius,
          y: ((seed % 11) - 5) * 0.09,
          z: Math.sin(angle) * radius,
        };
      }),
    );
  }, [events, runId]);

  return (
    <div className="execution-map">
      <Canvas
        aria-label="Execution relationship map"
        camera={{ position: [0, 4.6, 6.8], fov: 42 }}
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ antialias: true, alpha: true }}
      >
        <Scene nodes={nodes} />
      </Canvas>
      <p className="sr-only">
        Execution map containing {nodes.length} nodes. The adjacent evidence ledger provides the same information as text.
      </p>
    </div>
  );
}
