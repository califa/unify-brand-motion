import {makeProject} from '@motion-canvas/core';
import echo from './scenes/echo?scene';
import {setPlayer} from './controls';

export default makeProject({
  scenes: [echo],
  experimentalFeatures: true,
  plugins: [
    {
      name: 'echo-controls',
      player(player) {
        setPlayer(player);
      },
    },
  ],
});
