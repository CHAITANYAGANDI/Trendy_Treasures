const joi = require('joi');
const { USERNAME_REGEX, USERNAME_MESSAGE } = require('../utils/usernamePolicy');


const signupValidation = (req,res,next)=> {
    const schema = joi.object({
        name:joi.string().min(3).max(100).required(),
        username: joi.string()
            .min(3)
            .max(30)
            .pattern(USERNAME_REGEX)
            .required()
            .messages({
                'string.pattern.base': USERNAME_MESSAGE,
                'string.min': USERNAME_MESSAGE,
                'string.max': USERNAME_MESSAGE
            }),
        email: joi.string().email().required(),
        password: joi.string()
            .min(8)
            .max(100)
            .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$'))
            .required()
            .messages({
                'string.pattern.base':
                    'Password must be at least 8 characters and include uppercase, lowercase, and a digit.',
                'string.min': 'Password must be at least 8 characters.'
            })
    });

    const {error} = schema.validate(req.body);

    if (error){

        return res.status(400).json({message:"Bad Request",error})
    }

    next();
}


const loginvalidation = (req,res,next)=> {
    const schema = joi.object({
        // min 3 matches signup's username policy — at 4, three-character
        // usernames could register but never sign in. Emails fit too.
        username: joi.string().min(3).max(100).required(),
        password: joi.string().min(4).max(100).required()

    });

    const {error} = schema.validate(req.body);

    if (error){
        return res.status(400).json({message:'Bad request',error});
    }
    
    next();
}


module.exports = {
    signupValidation,
    loginvalidation
}