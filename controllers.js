export const Controllers = new Map();

// Returns a Map preserving parent controllers before their children
Controllers.order = function order() {
  const childControllers = new Set();
  const parentControllers = new Set();

  for (const [, controller] of Controllers) {
    if (controller && controller.belongs_to) {
      childControllers.add(controller);
    } else {
      parentControllers.add(controller);
    }
  }

  // Ensure each child has a parent controller present (single-level nesting)
  for (const controller of childControllers) {
    let hasParent = false;
    for (const parentController of parentControllers) {
      if (parentController.resources === controller.belongs_to) {
        hasParent = true;
        break;
      }
    }
    if (!hasParent) {
      throw new Error(
        `Controller ${controller.constructor?.name || 'Unknown'} has no parent Controller ${controller.belongs_to}`
      );
    }
  }

  const orderedControllers = new Map();
  for (const controller of parentControllers) {
    orderedControllers.set(controller.resources, controller);
  }
  for (const controller of childControllers) {
    orderedControllers.set(controller.resources, controller);
  }

  return orderedControllers;
};
