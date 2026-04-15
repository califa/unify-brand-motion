import {makeProject} from '@motion-canvas/core';
import scene from '../animations/washer?scene';
import {setPlayer} from './controls';

export default makeProject({
  scenes: [scene],
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
