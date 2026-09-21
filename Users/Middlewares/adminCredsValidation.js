const joi = require('joi');
const { STRONG_PASSWORD_REGEX, STRONG_PASSWORD_MESSAGE } = require('../utils/passwordPolicy');

const signupValidation = (req,res,next)=> {
    
    const schema = joi.object({
        name:joi.string().min(3).max(100).required(),
        // Admins sign in with an email: it doubles as the address the
        // password-recovery code is sent to, and it lands in the shared
        // unique `email` column alongside customer accounts.
        adminId: joi.string().email().max(100).required().messages({
            'string.email': 'Admin email must be a valid email address.'
        }),
        password: joi.string()
            .min(8)
            .max(100)
            .pattern(STRONG_PASSWORD_REGEX)
            .required()
            .messages({
                'string.pattern.base': STRONG_PASSWORD_MESSAGE,
                'string.min': 'Password must be at least 8 characters.'
            })
    });

    const {error} = schema.validate(req.body);

    if (error){

        return res.status(400).json({message:"Bad Request",error})
    }

    next();
}


// Login deliberately does NOT require an email format. Admins created
// before this rule have non-email IDs, and tightening it here would lock
// them out of their own accounts.
const loginvalidation = (req,res,next)=> {
    
    const schema = joi.object({
        adminId: joi.string().min(4).max(100).required(),
        password: joi.string().min(4).max(100).required()

    });

    const {error} = schema.validate(req.body);

    if (error){
        return res.status(400).json({message:'Bad request',error})


    }
    next();
}


module.exports = {
    signupValidation,
    loginvalidation
}
