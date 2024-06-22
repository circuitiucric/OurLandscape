// frontend/store/store.js
import { createStore, combineReducers } from "redux";

// 示例 reducer
const initialState = {};
const exampleReducer = (state = initialState, action) => {
  switch (action.type) {
    default:
      return state;
  }
};

// 确保你有至少一个 reducer
const rootReducer = combineReducers({
  example: exampleReducer,
});

const store = createStore(rootReducer);

export default store;
