import { useEffect, useRef } from 'react';

export function DataStreamBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const setCanvasSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setCanvasSize();
    window.addEventListener('resize', setCanvasSize);

    // Data stream particles
    interface Particle {
      x: number;
      y: number;
      speed: number;
      opacity: number;
      char: string;
      size: number;
    }

    const particles: Particle[] = [];
    const particleCount = 100;
    const chars = '01';

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: 0.5 + Math.random() * 1.5,
        opacity: Math.random() * 0.5 + 0.1,
        char: chars[Math.floor(Math.random() * chars.length)],
        size: 12 + Math.random() * 8,
      });
    }

    // Grid lines
    interface GridLine {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      opacity: number;
      pulse: number;
    }

    const gridLines: GridLine[] = [];
    const gridCount = 30;

    for (let i = 0; i < gridCount; i++) {
      const isVertical = Math.random() > 0.5;
      if (isVertical) {
        const x = Math.random() * canvas.width;
        gridLines.push({
          x1: x,
          y1: 0,
          x2: x,
          y2: canvas.height,
          opacity: 0.03 + Math.random() * 0.07,
          pulse: Math.random() * Math.PI * 2,
        });
      } else {
        const y = Math.random() * canvas.height;
        gridLines.push({
          x1: 0,
          y1: y,
          x2: canvas.width,
          y2: y,
          opacity: 0.03 + Math.random() * 0.07,
          pulse: Math.random() * Math.PI * 2,
        });
      }
    }

    // Connection nodes
    interface Node {
      x: number;
      y: number;
      radius: number;
      opacity: number;
      pulse: number;
      pulseSpeed: number;
    }

    const nodes: Node[] = [];
    const nodeCount = 20;

    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: 2 + Math.random() * 3,
        opacity: 0.2 + Math.random() * 0.3,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 0.02 + Math.random() * 0.03,
      });
    }

    let animationFrameId: number;
    let time = 0;

    const animate = () => {
      ctx.fillStyle = '#0a0e27';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      time += 0.01;

      // Draw grid lines with pulse effect
      gridLines.forEach((line) => {
        const pulseOpacity = line.opacity + Math.sin(time * 2 + line.pulse) * 0.02;
        ctx.strokeStyle = `rgba(59, 130, 246, ${pulseOpacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y1);
        ctx.lineTo(line.x2, line.y2);
        ctx.stroke();
      });

      // Draw connections between nodes
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 200) {
            const opacity = (1 - distance / 200) * 0.1;
            ctx.strokeStyle = `rgba(34, 211, 238, ${opacity})`;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw and update nodes
      nodes.forEach((node) => {
        node.pulse += node.pulseSpeed;
        const pulseRadius = node.radius + Math.sin(node.pulse) * 1;
        
        // Glow effect
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, pulseRadius * 3);
        gradient.addColorStop(0, `rgba(34, 211, 238, ${node.opacity * 0.3})`);
        gradient.addColorStop(1, 'rgba(34, 211, 238, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseRadius * 3, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = `rgba(34, 211, 238, ${node.opacity})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseRadius, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw and update particles
      particles.forEach((particle) => {
        // Update position
        particle.y += particle.speed;
        if (particle.y > canvas.height) {
          particle.y = -20;
          particle.x = Math.random() * canvas.width;
        }

        // Draw character with glow
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(59, 130, 246, 0.5)';
        ctx.fillStyle = `rgba(59, 130, 246, ${particle.opacity})`;
        ctx.font = `${particle.size}px monospace`;
        ctx.fillText(particle.char, particle.x, particle.y);
        ctx.shadowBlur = 0;
      });

      // Diagonal scan lines
      const scanLineY = (time * 100) % (canvas.height + 100);
      const gradient = ctx.createLinearGradient(0, scanLineY - 50, 0, scanLineY + 50);
      gradient.addColorStop(0, 'rgba(34, 211, 238, 0)');
      gradient.addColorStop(0.5, 'rgba(34, 211, 238, 0.03)');
      gradient.addColorStop(1, 'rgba(34, 211, 238, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, scanLineY - 50, canvas.width, 100);

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', setCanvasSize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{ imageRendering: 'crisp-edges' }}
    />
  );
}
