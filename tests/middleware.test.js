const { isAuthenticated } = require('../middleware');

describe('isAuthenticated', () => {
  let req, res, next;

  beforeEach(() => {
    req = { session: {}, xhr: false, headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json:   jest.fn().mockReturnThis(),
      redirect: jest.fn(),
    };
    next = jest.fn();
  });

  test('calls next() when session has a user', () => {
    req.session.user = { id: 1, username: 'testuser' };
    isAuthenticated(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('redirects to /login for unauthenticated HTML requests', () => {
    req.headers.accept = 'text/html';
    isAuthenticated(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 JSON for unauthenticated XHR requests', () => {
    req.xhr = true;
    isAuthenticated(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Not authenticated.' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 JSON when Accept header includes application/json', () => {
    req.headers.accept = 'application/json';
    isAuthenticated(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Not authenticated.' });
    expect(next).not.toHaveBeenCalled();
  });

  test('redirects when session exists but has no user property', () => {
    req.session = { someOtherKey: true };
    isAuthenticated(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });
});
