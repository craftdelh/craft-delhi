const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/mailHelper'); // adjust path as per your project

const otpModel = require('../models/otpModel');
const userModel = require('../models/userModel');

exports.sendOtp = (req, res) => {
  const { email, purpose = 'verify' } = req.body;

  if (!email) {
    return res.status(400).json({ status: false, message: 'Email is required' });
  }

  const allowedPurposes = ['verify', 'reset'];
  if (!allowedPurposes.includes(purpose)) {
    return res.status(400).json({ status: false, message: 'Invalid OTP purpose' });
  }

  const otp_type = purpose === 'reset' ? 'forgot_password' : 'email_verification';
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry

  userModel.findByEmail(email, (err, results) => {
    if (err) return res.status(500).json({ status: false, error: err });

    const userExists = Array.isArray(results) && results.length > 0;
    if (purpose === 'reset') {
      if (!userExists) {
        return res.status(404).json({ status: false, message: 'Email not found. Cannot reset password.' });
      }
      saveAndSendOtp();
    } else {

      // EMAIL VERIFICATION (SIGNUP FLOW)
      if (userExists) {
        const user = results[0];

        // ✅ Case 1: Fully registered user
        if (user.is_email_verified && user.password) {
          return res.status(400).json({
            status: false,
            message: 'Email already registered. Please login.'
          });
        }

        // ✅ Case 2: Email exists but incomplete signup → allow OTP resend
        return saveAndSendOtp();
      }

      // create email-only user then send OTP
      userModel.createEmailOnlyUser(email, (e) => {
        if (e) return res.status(500).json({ status: false, error: e });
        saveAndSendOtp();
      });

    }
  });

function saveAndSendOtp() {
  otpModel.saveOtp(email, otp, expiresAt, otp_type, async (err2) => {
    if (err2) {
      return res.status(500).json({ status: false, error: err2 });
    }

    try {
      await sendEmail({
        to: email,
        subject: 'Your Craft Delhi OTP',
        title: 'Email Verification',
        message: `
          Hello,<br><br>
          Your One-Time Password (OTP) for <b>Craft Delhi</b> verification is:
          <br><br>
          <b style="font-size: 24px; letter-spacing: 2px;">${otp}</b>
          <br><br>
          This OTP will expire in <b>10 minutes</b>. 
          Please do not share it with anyone for security reasons.
          <br><br>
          Best regards,<br>
          <b>Team Craft Delhi</b>
        `,
        text: `Your OTP is ${otp}. It will expire in 10 minutes.`,
      });

      res.json({ status: true, message: 'OTP sent to email' });
    } catch (error) {
      console.error('Error sending OTP email:', error);
      res.status(500).json({ status: false, error: 'Failed to send OTP email' });
    }
  });
}


};



// Verify OTP
exports.verifyOtp = (req, res) => {
  const { email, otp, purpose = 'verify' } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ status: false, message: 'Email and OTP are required' });
  }

  // Map purpose to otp_type
  const otp_type = purpose === 'reset' ? 'forgot_password' : 'email_verification';

  otpModel.findValidOtp(email, otp, otp_type, (err, results) => {
    if (err) return res.status(500).json({ status: false, error: err });
    if (!results.length) return res.status(400).json({ status: false, message: 'Invalid or expired OTP' });

    const otpEntry = results[0];

    const afterVerification = () => {
      res.json({ status: true, message: 'OTP verified successfully' });
    };

    otpModel.markOtpVerified(otpEntry.id, (err2) => {
      if (err2) return res.status(500).json({ status: false, error: err2 });

      if (otp_type === 'email_verification') {
        userModel.markEmailVerified(email, (err3) => {
          if (err3) return res.status(500).json({ status: false, error: err3 });
          afterVerification();
        });
      } else {
        afterVerification(); // Skip marking email verified for forgot password
      }
    });
  });
};



// Complete Registration After Email Verification
exports.register = (req, res) => {
  const {
    email,
    first_name,
    last_name,
    password,
    phone_number,
    dob,
    role,
    gender
  } = req.body;

  if (
    !email ||
    !first_name ||
    !last_name ||
    !phone_number ||
    !dob ||
    role === undefined ||
    gender === undefined
  ) {
    return res.status(400).json({
      status: false,
      message: 'Required fields are missing'
    });
  }

  const roleNum = Number(role);
  const hashed =
    roleNum === 3 ? null : bcrypt.hashSync(password, 10);

  userModel.findByEmail(email, (err, results) => {
    if (err) {
      return res.status(500).json({ status: false, error: err });
    }

    const userExists = results.length > 0;
    const user = userExists ? results[0] : null;

    /* ======================================================
       BUYER FLOW (role = 3)
    ====================================================== */
    if (roleNum === 3) {

      // Buyer already activated
      if (userExists && user.password) {
        return res.status(400).json({
          status: false,
          message: 'Account already exists. Please login.'
        });
      }

      // Create email-only user if not exists
      if (!userExists) {
        return userModel.createEmailOnlyUser(email, (errCreate) => {
          if (errCreate) {
            return res.status(500).json({ status: false, error: errCreate });
          }

          saveBuyerDetails();
        });
      }

      // Resume incomplete buyer registration
      return saveBuyerDetails();

      function saveBuyerDetails() {
        userModel.updateUserDetailsWithoutVerification(
          {
            email,
            first_name,
            last_name,
            password: null,
            phone_number,
            dob,
            role: roleNum,
            gender
          },
          (errUpdate) => {
            if (errUpdate) {
              return res.status(500).json({ status: false, error: errUpdate });
            }

            return res.status(201).json({
              status: true,
              message: 'Buyer registered. Please verify your email to set password.'
            });
          }
        );
      }
    }

    /* ======================================================
       SELLER FLOW (role = 2)
    ====================================================== */
    if (roleNum === 2) {

      if (!userExists) {
        return res.status(404).json({
          status: false,
          message: 'Email not found. Please verify email first.'
        });
      }

      if (!user.is_email_verified) {
        return res.status(400).json({
          status: false,
          message: 'Email not verified'
        });
      }

      // Resume incomplete seller registration
      if (!user.password && !user.first_name) {
        return userModel.updateUserDetails(
          {
            email,
            first_name,
            last_name,
            password: hashed,
            phone_number,
            dob,
            role: roleNum,
            gender
          },
          async (errUpdate) => {
            if (errUpdate) {
              return res.status(500).json({ status: false, error: errUpdate });
            }

            try {
              await sendEmail({
                to: process.env.ADMIN_EMAIL,
                subject: 'New Seller Registration Request - Craft Delhi',
                title: 'New Seller Approval Request',
                message: `
                  Hello Admin,<br><br>

                  A new seller has registered on <b>Craft Delhi</b> and is awaiting approval.<br><br>

                  <b>User Details:</b><br>
                  Name: ${first_name} ${last_name}<br>
                  Email: ${email}<br>
                  Phone: ${phone_number}<br>
                  Gender: ${gender}<br>
                  DOB: ${dob}<br><br>

                  Please review and approve/reject this seller from the admin panel.<br><br>

                  Regards,<br>
                  <b>Craft Delhi System</b>
                `,
                text: `
                  New seller registration request.

                  Name: ${first_name} ${last_name}
                  Email: ${email}
                  Phone: ${phone_number}
                `,
              });

            } catch (mailErr) {
              console.error('Admin approval email failed:', mailErr);
            }

            return res.status(201).json({
              status: true,
              message: 'Registration completed successfully. Awaiting approval.'
            });
          }
        );
      }

      // Seller already registered
      return res.status(400).json({
        status: false,
        message: 'User already registered. Please login.'
      });
    }

    /* ======================================================
       INVALID ROLE
    ====================================================== */
    return res.status(400).json({
      status: false,
      message: 'Invalid role'
    });
  });
};

exports.setPassword = (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ status: false, message: 'Email and password are required' });
  }

  userModel.findByEmail(email, (err, results) => {
    if (err) return res.status(500).json({ status: false, error: err });

    if (!results || results.length === 0) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    const user = results[0];

    // 🔍 Check if email is verified
    if (!user.is_email_verified) {
      return res
        .status(400)
        .json({ status: false, message: 'Email is not verified' });
    }
    if (user.password) {
      return res.status(400).json({
        status: false,
        message: 'Password already set. Please use forgot password.'
      });
    }

    const hashed = bcrypt.hashSync(password, 10);

    userModel.updatePasswordByEmail(email, hashed, async (errUpdate) => {
      if (errUpdate)
        return res.status(500).json({ status: false, error: errUpdate });

      try {
        // ✅ Send confirmation email (no button)
        await sendEmail({
          to: email,
          subject: 'Password Set Successfully - Craft Delhi',
          title: 'Password Set Successfully',
          message: `
            Hello,<br><br>
            Your password has been successfully set for your <b>Craft Delhi</b> account.<br><br>
            You can now log in and explore our platform.<br><br>
            If you didn’t request this action, please <b>contact our support team immediately</b>.<br><br>
            Warm regards,<br>
            <b>Team Craft Delhi</b>
          `,
          text: `Hello,\n\nYour password has been set successfully for your Craft Delhi account.\n\nIf this wasn't you, please contact our support team immediately.`,
        });

        res.json({
          status: true,
          message: 'Password set successfully. Confirmation email sent.',
        });
      } catch (mailErr) {
        console.error('Failed to send password set confirmation email:', mailErr);
        res.json({
          status: true,
          message:
            'Password set successfully, but confirmation email could not be sent.',
        });
      }
    });
  });
};

// Login
exports.login = (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      status: false,
      message: 'Email and password are required'
    });
  }

  userModel.findByEmail(email, (err, results) => {
    if (err) {
      return res.status(500).json({ status: false, error: err });
    }

    if (!results.length) {
      return res.status(404).json({
        status: false,
        message: 'User not found'
      });
    }

    const user = results[0];
    if (user.account_trashed === 1) {
      return res.status(403).json({
        status: false,
        message: 'Your account has been deleted.'
      });
    }
    if (!user.is_email_verified) {
      return res.status(403).json({
        status: false,
        message: 'Email is not verified.'
      });
    }
    if (!user.password || !user.first_name) {
      return res.status(400).json({
        status: false,
        message: 'Registration not completed. Please finish signup.'
      });
    }
    if (user.role !== 3 && user.user_approval === 0) {
      return res.status(200).json({
        status: false,
        message: 'Pending approval from admin. We will notify you once approved.'
      });
    }
    if (user.role !== 3 && user.user_approval === 2) {
      return res.status(403).json({
        status: false,
        message: 'Your registration has been rejected by admin.'
      });
    }
    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        status: false,
        message: 'Invalid credentials'
      });
    }

    // ✅ Success
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        name: user.first_name + " " + user.last_name
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      status: true,
      token,
      role: user.role,
      id: user.id,
      name: user.first_name + " " + user.last_name
    });
  });
};


// Reset Password
exports.resetPassword = (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res
      .status(400)
      .json({ status: false, message: 'Email and new password are required' });
  }

  otpModel.checkIfOtpVerified(email, 'forgot_password', (err, isVerified) => {
    if (err) return res.status(500).json({ status: false, error: err });

    if (!isVerified) {
      return res.status(400).json({
        status: false,
        message: 'OTP not verified. Please verify your OTP first.',
      });
    }

    bcrypt.hash(newPassword, 10, (err2, hashedPassword) => {
      if (err2) return res.status(500).json({ status: false, error: err2 });

      userModel.updatePasswordByEmail(email, hashedPassword, (err3) => {
        if (err3) return res.status(500).json({ status: false, error: err3 });

        otpModel.clearOtpVerification(email, 'forgot_password', async () => {
          try {
            // ✅ Send success email (no button)
            await sendEmail({
              to: email,
              subject: 'Password Reset Successful - Craft Delhi',
              title: 'Password Reset Confirmation',
              message: `
                Hello,<br><br>
                Your password for <b>Craft Delhi</b> has been reset successfully.<br><br>
                If you did not initiate this action, please <b>contact our support team immediately</b> to secure your account.<br><br>
                Stay safe,<br>
                <b>Team Craft Delhi</b>
              `,
              text: `Hello,\n\nYour password has been reset successfully. If you did not perform this action, please contact support immediately.`,
            });

            res.json({
              status: true,
              message: 'Password reset successful',
            });
          } catch (mailErr) {
            console.error('Failed to send password reset success email:', mailErr);
            res.json({
              status: true,
              message: 'Password reset successful, but email could not be sent.',
            });
          }
        });
      });
    });
  });
};



exports.tempApproval = (req, res) => {
  const { email, approvalstatus } = req.body;

  if (!email || ! approvalstatus) {
    return res.status(400).json({ status: false, message: 'Email and approvalstatus are required' });
  }

  userModel.tempApproval(email,approvalstatus, (err, results) => {
    if (err) return res.status(500).json({ status: false, error: err });
    res.json({ status: true,  message: 'Email Approved Successfully.' });
  });
};


exports.makeAccountTrash = (req, res) => {

  const {id} = req.user;
  if (!id) {
    return res.status(400).json({ status: false, message: 'user_id is required' });
  }

  userModel.makeAccountTrash(id, (err, results) => {
    if (err) return res.status(500).json({ status: false, error: err });
    res.json({ status: true,  message: 'Account Trashed Successfully.' });
  });
};