import React from 'react';
import ParticleSphere from './src/ParticleSphere/index.jsx';

export default function App() {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: 600, height: 600 }}>
        <ParticleSphere />
      </div>
    </div>
  );
}
